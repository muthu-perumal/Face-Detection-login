import { randomInt, randomBytes } from 'crypto';
import {
  CHALLENGE_COPY,
  assessLiveness,
  averageDescriptor,
  euclidean,
  samplesAreConsistent,
} from '../../shared/attendance';
import { CONSENT_VERSION, MODEL_VERSION, TEMPLATE_VERSION, VERIFICATION_DISCLOSURE, type ChallengeInstruction } from '../../shared/types';
import { enrollSchema } from '../../shared/schemas';
import { encryptTemplate, decryptTemplate } from '../crypto';
import { withUser, type DbClient } from '../db';
import { audit, requireUser } from '../context';
import { HttpError, json, parseBody, readJson } from '../http';
import type { SessionUser } from '../map';
import type { AttendanceSettings } from '../../shared/types';

const INSTRUCTIONS: ChallengeInstruction[] = ['turn_left', 'turn_right', 'nod'];

export async function createChallenge(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const instruction = INSTRUCTIONS[randomInt(0, INSTRUCTIONS.length)];
  const created = await withUser({ id: user.id, role: user.role }, async (client) => {
    const result = await client.query(
      `INSERT INTO verification_challenges (employee_id, instruction, nonce, expires_at)
       VALUES ($1, $2, $3, now() + interval '90 seconds')
       RETURNING id, expires_at`,
      [user.id, instruction, randomBytes(16).toString('hex')],
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

export async function faceStatus(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const status = await withUser({ id: user.id, role: user.role }, async (client) => readStatus(client, user.id));
  return json({ enrollment: status, disclosure: VERIFICATION_DISCLOSURE });
}

export async function enrollFace(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const body = parseBody(enrollSchema, await readJson(request));
  if (body.consentVersion !== CONSENT_VERSION) {
    throw new HttpError(400, 'Open enrollment again and accept the current consent notice.');
  }
  const outcome = await withUser({ id: user.id, role: user.role }, async (client) => {
    const settings = await client.query('SELECT face_reenroll_policy FROM attendance_settings WHERE id = 1');
    const policy = String(settings.rows[0].face_reenroll_policy);
    const existing = await readStatus(client, user.id);
    if (existing) {
      if (policy === 'disabled') return fail(403, 'Face re-enrollment is disabled.');
      if (policy === 'admin_only') return fail(403, 'An administrator must reset your face enrollment.');
    }
    const verdict = await matchLiveSamples(client, user.id, body.challengeId, body.samples, body.landmarks, null);
    if (!verdict.ok) return fail(401, verdict.reason);
    const encrypted = encryptTemplate(verdict.descriptor);
    await client.query(
      `INSERT INTO face_enrollments
        (employee_id, encrypted_template, template_version, model_version, consent_version, consent_timestamp, status)
       VALUES ($1, $2, $3, $4, $5, now(), 'active')
       ON CONFLICT (employee_id) DO UPDATE
       SET encrypted_template = EXCLUDED.encrypted_template,
           template_version = EXCLUDED.template_version,
           model_version = EXCLUDED.model_version,
           consent_version = EXCLUDED.consent_version,
           consent_timestamp = now(),
           status = 'active'`,
      [user.id, encrypted, TEMPLATE_VERSION, MODEL_VERSION, CONSENT_VERSION],
    );
    await audit(client, user.id, existing ? 'face.reenrolled' : 'face.enrolled', user.id, {
      model: MODEL_VERSION,
      consent: CONSENT_VERSION,
    });
    return {
      status: 200,
      body: {
        ok: true,
        message: 'Face enrollment saved. The numeric template is encrypted and no enrollment photo was stored.',
        disclosure: VERIFICATION_DISCLOSURE.summary,
      },
    };
  });
  return json(outcome.body, outcome.status);
}

export async function deleteEnrollment(request: Request): Promise<Response> {
  const user = await requireUser(request);
  await withUser({ id: user.id, role: user.role }, async (client) => {
    const policy = await client.query('SELECT face_reenroll_policy FROM attendance_settings WHERE id = 1');
    const mode = String(policy.rows[0].face_reenroll_policy);
    if (mode === 'disabled') throw new HttpError(403, 'Face deletion is disabled by policy.');
    if (mode === 'admin_only') throw new HttpError(403, 'An administrator must reset your face enrollment.');
    const removed = await client.query('DELETE FROM face_enrollments WHERE employee_id = $1 RETURNING id', [user.id]);
    if (!removed.rows[0]) throw new HttpError(404, 'No face enrollment was found.');
    await audit(client, user.id, 'face.deleted', user.id);
  });
  return json({ ok: true, message: 'Face enrollment deleted.' });
}

export async function verifyForAttendance(
  client: DbClient,
  user: SessionUser,
  challengeId: string,
  samples: number[][],
  landmarks: Parameters<typeof assessLiveness>[0],
  settings: AttendanceSettings,
): Promise<{ ok: true; distance: number; reference: string } | { ok: false; reason: string; distance: number | null }> {
  const stored = await client.query('SELECT read_own_template($1) AS template', [user.id]);
  const template = stored.rows[0]?.template ? String(stored.rows[0].template) : '';
  if (!template) {
    const blocked = await matchLiveSamples(client, user.id, challengeId, samples, landmarks, null);
    const reason = blocked.ok ? 'Enroll your face before using face verification.' : blocked.reason;
    await client.query(
      'INSERT INTO verification_attempts (employee_id, success, reason, distance) VALUES ($1, false, $2, NULL)',
      [user.id, reason],
    );
    return { ok: false, reason, distance: null };
  }
  const verdict = await matchLiveSamples(client, user.id, challengeId, samples, landmarks, template);
  if (!verdict.ok) {
    await client.query(
      'INSERT INTO verification_attempts (employee_id, success, reason, distance) VALUES ($1, false, $2, $3)',
      [user.id, verdict.reason, verdict.distance],
    );
    return { ok: false, reason: verdict.reason, distance: verdict.distance };
  }
  if (verdict.distance > settings.faceDistanceThreshold) {
    const reason = 'The face does not match the enrolled template.';
    await client.query(
      'INSERT INTO verification_attempts (employee_id, success, reason, distance) VALUES ($1, false, $2, $3)',
      [user.id, reason, verdict.distance],
    );
    return { ok: false, reason, distance: verdict.distance };
  }
  const attempt = await client.query(
    'INSERT INTO verification_attempts (employee_id, success, reason, distance) VALUES ($1, true, $2, $3) RETURNING id',
    [user.id, 'Descriptor distance within the configured threshold.', verdict.distance],
  );
  return { ok: true, distance: verdict.distance, reference: `dev-face:${String(attempt.rows[0].id)}` };
}

export async function readChallengeDescriptor(
  client: DbClient,
  challengeId: string,
  employeeId: string | null,
  samples: number[][],
  landmarks: Parameters<typeof assessLiveness>[0],
): Promise<{ ok: true; descriptor: number[] } | { ok: false; reason: string }> {
  const consumed = await client.query(
    employeeId
      ? `UPDATE verification_challenges
         SET used_at = now()
         WHERE id = $1 AND employee_id = $2 AND used_at IS NULL AND expires_at > now()
         RETURNING instruction`
      : `UPDATE verification_challenges
         SET used_at = now()
         WHERE id = $1 AND employee_id IS NULL AND used_at IS NULL AND expires_at > now()
         RETURNING instruction`,
    employeeId ? [challengeId, employeeId] : [challengeId],
  );
  if (!consumed.rows[0]) {
    return { ok: false, reason: 'This verification challenge expired or was already used. Start again.' };
  }
  const instruction = String(consumed.rows[0].instruction) as ChallengeInstruction;
  const liveness = assessLiveness(landmarks, instruction);
  if (!liveness.ok) return { ok: false, reason: liveness.reason };
  try {
    const normalized = normalizeSamples(samples);
    if (!samplesAreConsistent(normalized)) {
      return { ok: false, reason: 'The captured samples were not stable. Hold still and try again.' };
    }
    return { ok: true, descriptor: averageDescriptor(normalized) };
  } catch (error) {
    const message = error instanceof HttpError ? error.message : 'Invalid face sample.';
    return { ok: false, reason: message };
  }
}

async function matchLiveSamples(
  client: DbClient,
  userId: string,
  challengeId: string,
  samples: number[][],
  landmarks: Parameters<typeof assessLiveness>[0],
  enrolledTemplate: string | null,
): Promise<{ ok: true; descriptor: number[]; distance: number } | { ok: false; reason: string; distance: number | null }> {
  const captured = await readChallengeDescriptor(client, challengeId, userId, samples, landmarks);
  if (!captured.ok) return { ok: false, reason: captured.reason, distance: null };
  const descriptor = captured.descriptor;
  if (!enrolledTemplate) {
    return { ok: true, descriptor, distance: 0 };
  }
  let enrolled: number[];
  try {
    enrolled = decryptTemplate(enrolledTemplate);
  } catch {
    return { ok: false, reason: 'The enrolled template could not be read. Re-enroll your face.', distance: null };
  }
  return { ok: true, descriptor, distance: euclidean(descriptor, enrolled) };
}

function normalizeSamples(samples: number[][]): number[][] {
  if (samples.length < 3 || samples.length > 8) throw new HttpError(400, 'Capture between three and eight face samples.');
  return samples.map((sample) => {
    if (sample.length !== 128 || sample.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new HttpError(400, 'Invalid face sample.');
    }
    const norm = Math.hypot(...sample);
    if (norm < 0.75 || norm > 1.25) throw new HttpError(400, 'Invalid face sample.');
    return sample.map((value) => value / norm);
  });
}

async function readStatus(client: DbClient, userId: string) {
  const result = await client.query(
    `SELECT template_version, model_version, enrolled_at, consent_version, consent_timestamp, status
     FROM face_enrollments WHERE employee_id = $1`,
    [userId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || row.status !== 'active') return null;
  return {
    enrolled: true,
    templateVersion: String(row.template_version),
    modelVersion: String(row.model_version),
    enrolledAt: new Date(row.enrolled_at as string).toISOString(),
    consentVersion: String(row.consent_version),
    consentAt: new Date(row.consent_timestamp as string).toISOString(),
  };
}

function fail(status: number, error: string) {
  return { status, body: { error, calibrated: false, engine: VERIFICATION_DISCLOSURE.id } };
}
