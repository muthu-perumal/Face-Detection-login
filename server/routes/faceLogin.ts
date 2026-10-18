import { randomBytes, randomInt } from 'crypto';
import { arrivalStatus, CHALLENGE_COPY, euclidean, formatClock, formatDuration, zonedParts } from '../../shared/attendance';
import { faceLoginSchema } from '../../shared/schemas';
import { VERIFICATION_DISCLOSURE, type ChallengeInstruction } from '../../shared/types';
import { decryptTemplate } from '../crypto';
import { withUser, type DbClient } from '../db';
import { audit, getSettings, serverNow } from '../context';
import { clientIp, json, parseBody, readJson } from '../http';
import { mapUser } from '../map';
import { signToken } from '../tokens';
import { readChallengeDescriptor } from './face';

const INSTRUCTIONS: ChallengeInstruction[] = ['turn_left', 'turn_right', 'nod'];
const MATCH_MARGIN = 0.08;

export async function createLoginChallenge(request: Request): Promise<Response> {
  const ip = clientIp(request);
  const blocked = await failedAttempts(ip);
  if (blocked) return json({ error: 'Too many face sign-in attempts. Try again in a few minutes.' }, 429);
  const instruction = INSTRUCTIONS[randomInt(0, INSTRUCTIONS.length)];
  const created = await withUser({ id: '', role: 'system' }, async (client) => {
    const result = await client.query(
      `INSERT INTO verification_challenges (employee_id, instruction, nonce, expires_at)
       VALUES (NULL, $1, $2, now() + interval '90 seconds')
       RETURNING id, expires_at`,
      [instruction, randomBytes(16).toString('hex')],
    );
    return result.rows[0] as { id: string; expires_at: string };
  });
  return json({
    challengeId: created.id,
    instruction,
    prompt: CHALLENGE_COPY[instruction],
    expiresAt: new Date(created.expires_at).toISOString(),
    disclosure: VERIFICATION_DISCLOSURE.summary,
  });
}

export async function faceLogin(request: Request): Promise<Response> {
  const body = parseBody(faceLoginSchema, await readJson(request));
  const ip = clientIp(request);
  if (await failedAttempts(ip)) {
    return json({ error: 'Too many face sign-in attempts. Try again in a few minutes.' }, 429);
  }
  const result = await withUser({ id: '', role: 'system' }, async (client) => {
    const captured = await readChallengeDescriptor(client, body.challengeId, null, body.samples, body.landmarks);
    if (!captured.ok) {
      await recordFailure(client, ip);
      return { status: 401, body: { error: captured.reason, calibrated: false, engine: VERIFICATION_DISCLOSURE.id } };
    }
    const settings = await getSettings(client);
    const templates = await client.query('SELECT employee_id, encrypted_template FROM list_login_templates()');
    let best: { employeeId: string; distance: number } | null = null;
    let second = Number.POSITIVE_INFINITY;
    for (const row of templates.rows) {
      let enrolled: number[];
      try {
        enrolled = decryptTemplate(String(row.encrypted_template));
      } catch {
        continue;
      }
      const distance = euclidean(captured.descriptor, enrolled);
      if (!best || distance < best.distance) {
        if (best) second = Math.min(second, best.distance);
        best = { employeeId: String(row.employee_id), distance };
      } else if (distance < second) {
        second = distance;
      }
    }
    const unique = best && best.distance <= settings.faceDistanceThreshold && second - best.distance >= MATCH_MARGIN;
    if (!best || !unique) {
      await recordFailure(client, ip);
      const reason = best && best.distance <= settings.faceDistanceThreshold
        ? 'More than one enrolled face is too similar. Use email and password.'
        : 'No enrolled face matched. Use email and password, or enroll a face after signing in.';
      return { status: 401, body: { error: reason, calibrated: false, engine: VERIFICATION_DISCLOSURE.id } };
    }
    const found = await client.query(
      `SELECT id, employee_id, full_name, email, department, designation, role, status, avatar_data
       FROM profiles WHERE id = $1 AND status = 'active'`,
      [best.employeeId],
    );
    const row = found.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      await recordFailure(client, ip);
      return { status: 401, body: { error: 'No enrolled face matched. Use email and password, or enroll a face after signing in.' } };
    }
    const session = await client.query(
      `INSERT INTO sessions (user_id, expires_at) VALUES ($1, now() + interval '12 hours') RETURNING id`,
      [row.id],
    );
    const user = mapUser(row, String(session.rows[0].id));
    await client.query('INSERT INTO login_attempts (email, success, ip_address) VALUES ($1, true, $2)', [user.email, ip]);
    await client.query(
      'INSERT INTO verification_attempts (employee_id, success, reason, distance) VALUES ($1, true, $2, $3)',
      [user.id, 'Face sign-in matched a single enrolled template.', best.distance],
    );
    await audit(client, user.id, 'auth.face_login', user.id, { distance: Number(best.distance.toFixed(4)) });
    const attendance = await markToday(client, user.id);
    return {
      status: 200,
      body: {
        token: signToken(user.id, user.sid),
        user,
        action: attendance.action,
        message: attendance.message,
        calibrated: false,
        engine: VERIFICATION_DISCLOSURE.id,
      },
    };
  });
  return json(result.body, result.status);
}

async function failedAttempts(ip: string): Promise<boolean> {
  const recent = await withUser({ id: '', role: 'system' }, (client) =>
    client.query(
      `SELECT count(*)::int AS count FROM login_attempts
       WHERE email = $1 AND success = false AND created_at > now() - interval '15 minutes'`,
      [`face:${ip}`],
    ),
  );
  return Number(recent.rows[0].count) >= 8;
}

async function recordFailure(client: DbClient, ip: string) {
  await client.query('INSERT INTO login_attempts (email, success, ip_address) VALUES ($1, false, $2)', [`face:${ip}`, ip]);
}

async function markToday(
  client: DbClient,
  employeeId: string,
): Promise<{ action: 'clock_in' | 'clock_out' | 'already_complete'; message: string }> {
  const settings = await getSettings(client);
  const now = await serverNow(client);
  const today = zonedParts(now, settings.timezone).date;
  const existing = await client.query(
    `SELECT id, clock_in_at, clock_out_at FROM attendance
     WHERE employee_id = $1 AND attendance_date = $2::date AND session_index = 1
     FOR UPDATE`,
    [employeeId, today],
  );
  const row = existing.rows[0];
  if (!row) {
    const status = arrivalStatus(now, settings);
    const inserted = await client.query(
      `INSERT INTO attendance (employee_id, attendance_date, clock_in_at, status, verification_method, session_index)
       VALUES ($1, $2::date, now(), $3, 'face', 1)
       RETURNING id, clock_in_at`,
      [employeeId, today, status],
    );
    await client.query(
      `INSERT INTO attendance_events (attendance_id, employee_id, event_type, verification_reference)
       VALUES ($1, $2, 'clock_in', $3)`,
      [inserted.rows[0].id, employeeId, 'face-login'],
    );
    await audit(client, employeeId, 'attendance.clock_in', String(inserted.rows[0].id), { method: 'face', status });
    const when = formatClock(new Date(inserted.rows[0].clock_in_at as string), settings.timezone);
    return { action: 'clock_in', message: `Face recognized. Signed in and clocked in at ${when}.` };
  }
  if (!row.clock_out_at) {
    const updated = await client.query(
      `UPDATE attendance SET clock_out_at = now() WHERE id = $1 RETURNING clock_out_at, total_minutes`,
      [row.id],
    );
    await client.query(
      `INSERT INTO attendance_events (attendance_id, employee_id, event_type, verification_reference)
       VALUES ($1, $2, 'clock_out', 'face-login')`,
      [row.id, employeeId],
    );
    await audit(client, employeeId, 'attendance.clock_out', String(row.id), { method: 'face' });
    const total = Number(updated.rows[0].total_minutes ?? 0);
    return { action: 'clock_out', message: `Face recognized. Clocked out for today. Total working time: ${formatDuration(total)}.` };
  }
  return { action: 'already_complete', message: 'You already clocked out today. Signed in without another attendance record.' };
}
