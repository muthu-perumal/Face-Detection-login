import {
  arrivalStatus,
  eachDate,
  formatClock,
  formatDuration,
  isoWeekday,
  monthBounds,
  timeToMinutes,
  zonedParts,
} from '../../shared/attendance';
import { MAX_FAILED_VERIFICATIONS } from '../../shared/types';
import { facePayloadSchema } from '../../shared/schemas';
import { withUser, type DbClient } from '../db';
import { audit, getSettings, requireUser, serverNow } from '../context';
import { HttpError, json, parseBody, readJson } from '../http';
import { mapAttendance } from '../map';
import { verifyForAttendance } from './face';
import { VERIFICATION_DISCLOSURE } from '../../shared/types';

const ATTENDANCE_SELECT = `
  a.id, a.employee_id, a.attendance_date::text AS attendance_date, a.clock_in_at, a.clock_out_at,
  a.total_minutes, a.status, a.verification_method, p.employee_id AS employee_code, p.full_name, p.department
`;

export async function clockIn(request: Request): Promise<Response> {
  return clock(request, 'in');
}

export async function clockOut(request: Request): Promise<Response> {
  return clock(request, 'out');
}

async function clock(request: Request, action: 'in' | 'out'): Promise<Response> {
  const user = await requireUser(request);
  const body = parseBody(facePayloadSchema, await readJson(request));
  const outcome = await withUser({ id: user.id, role: user.role }, async (client) => {
    const settings = await getSettings(client);
    const now = await serverNow(client);
    const today = zonedParts(now, settings.timezone).date;
    const failures = await failureCount(client, user.id);
    if (body.method === 'face' && failures >= MAX_FAILED_VERIFICATIONS) {
      await ensureReview(client, user.id, today, action, 'Too many failed face verification attempts.');
      return { status: 429, body: { error: 'Too many failed attempts. A manual review has been requested.', statusText: 'pending_review' } };
    }

    const existing = await lockAttendance(client, user.id, today);
    if (action === 'in' && existing?.clock_in_at) return { status: 409, body: { error: 'You have already clocked in today.' } };
    if (action === 'out' && !existing?.clock_in_at) return { status: 409, body: { error: 'Clock out requires an existing clock-in.' } };
    if (action === 'out' && existing?.clock_out_at) return { status: 409, body: { error: 'You have already clocked out today.' } };

    let method: 'face' | 'manual' = 'manual';
    let reference: string | null = null;
    if (body.method === 'manual') {
      if (!settings.allowManualAttendance) return { status: 403, body: { error: 'Manual attendance is disabled.' } };
      if (settings.requireFaceVerification) {
        await ensureReview(client, user.id, today, action, 'Employee requested manual attendance.');
        await audit(client, user.id, 'attendance.manual_requested', user.id, { action, date: today });
        return {
          status: 202,
          body: { status: 'pending_review', message: 'Manual attendance was submitted for administrator review.' },
        };
      }
    } else {
      if (!settings.requireFaceVerification && body.method === 'face' && !body.samples) {
        return { status: 400, body: { error: 'Face samples are required for face verification.' } };
      }
      if (!body.challengeId || !body.samples || !body.landmarks) {
        return { status: 400, body: { error: 'Face verification samples are required.' } };
      }
      const verdict = await verifyForAttendance(client, user, body.challengeId, body.samples, body.landmarks, settings);
      if (!verdict.ok) {
        if (failures + 1 >= MAX_FAILED_VERIFICATIONS) {
          await ensureReview(client, user.id, today, action, verdict.reason);
        }
        return {
          status: 401,
          body: {
            error: verdict.reason,
            distance: verdict.distance,
            threshold: settings.faceDistanceThreshold,
            calibrated: false,
            engine: VERIFICATION_DISCLOSURE.id,
          },
        };
      }
      method = 'face';
      reference = verdict.reference;
    }

    if (action === 'in') {
      const status = arrivalStatus(now, settings);
      const inserted = await client.query(
        `INSERT INTO attendance (employee_id, attendance_date, clock_in_at, status, verification_method, session_index)
         VALUES ($1, $2::date, now(), $3, $4, 1)
         RETURNING id, clock_in_at`,
        [user.id, today, status, method],
      );
      await client.query(
        `INSERT INTO attendance_events (attendance_id, employee_id, event_type, verification_reference)
         VALUES ($1, $2, 'clock_in', $3)`,
        [inserted.rows[0].id, user.id, reference],
      );
      await audit(client, user.id, 'attendance.clock_in', String(inserted.rows[0].id), { method, status, engine: VERIFICATION_DISCLOSURE.id });
      const when = formatClock(new Date(inserted.rows[0].clock_in_at as string), settings.timezone);
      const prefix = method === 'face' ? 'Face verified successfully. ' : '';
      return {
        status: 200,
        body: {
          message: `${prefix}Clock In completed at ${when}.`,
          calibrated: false,
          engine: method === 'face' ? VERIFICATION_DISCLOSURE.id : 'manual',
        },
      };
    }

    const updated = await client.query(
      `UPDATE attendance SET clock_out_at = now() WHERE id = $1
       RETURNING clock_out_at, total_minutes`,
      [existing!.id],
    );
    await client.query(
      `INSERT INTO attendance_events (attendance_id, employee_id, event_type, verification_reference)
       VALUES ($1, $2, 'clock_out', $3)`,
      [existing!.id, user.id, reference],
    );
    await audit(client, user.id, 'attendance.clock_out', existing!.id, { method });
    const total = Number(updated.rows[0].total_minutes ?? 0);
    const prefix = method === 'face' ? 'Face verified successfully. ' : '';
    return {
      status: 200,
      body: {
        message: `${prefix}Clock Out successful. Total working time: ${formatDuration(total)}.`,
        totalMinutes: total,
        calibrated: false,
        engine: method === 'face' ? VERIFICATION_DISCLOSURE.id : 'manual',
      },
    };
  });
  return json(outcome.body, outcome.status);
}

export async function dashboard(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const data = await withUser({ id: user.id, role: user.role }, async (client) => buildDashboard(client, user.id));
  return json(data);
}

export async function history(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  const status = url.searchParams.get('status') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HttpError(400, 'Choose a valid date range.');
  }
  const data = await withUser({ id: user.id, role: user.role }, async (client) => {
    const settings = await getSettings(client);
    const now = await serverNow(client);
    const today = zonedParts(now, settings.timezone).date;
    const result = await client.query(
      `SELECT ${ATTENDANCE_SELECT}
       FROM attendance a JOIN profiles p ON p.id = a.employee_id
       WHERE a.employee_id = $1 AND a.attendance_date BETWEEN $2::date AND $3::date
       ORDER BY a.attendance_date DESC`,
      [user.id, from, to],
    );
    let records = result.rows.map((row) => mapAttendance(row as Record<string, unknown>, settings, now, today));
    if (status) records = records.filter((record) => record.displayStatus === status);
    return { records, settings, today };
  });
  return json(data);
}

async function buildDashboard(client: DbClient, userId: string) {
  const settings = await getSettings(client);
  const now = await serverNow(client);
  const today = zonedParts(now, settings.timezone).date;
  const [year, month] = today.split('-').map(Number);
  const bounds = monthBounds(year, month);
  const monthRows = await client.query(
    `SELECT ${ATTENDANCE_SELECT}
     FROM attendance a JOIN profiles p ON p.id = a.employee_id
     WHERE a.employee_id = $1 AND a.attendance_date BETWEEN $2::date AND $3::date
     ORDER BY a.attendance_date`,
    [userId, bounds.from, bounds.to],
  );
  const recentRows = await client.query(
    `SELECT ${ATTENDANCE_SELECT}
     FROM attendance a JOIN profiles p ON p.id = a.employee_id
     WHERE a.employee_id = $1
     ORDER BY a.attendance_date DESC LIMIT 8`,
    [userId],
  );
  const face = await client.query(
    `SELECT enrolled_at, status FROM face_enrollments WHERE employee_id = $1`,
    [userId],
  );
  const reviews = await client.query(
    `SELECT id, requested_action, reason, status, attendance_date::text AS attendance_date
     FROM manual_reviews WHERE employee_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 5`,
    [userId],
  );
  const records = monthRows.rows.map((row) => mapAttendance(row as Record<string, unknown>, settings, now, today));
  const todayRecord = records.find((record) => record.attendanceDate === today) || null;
  const worked = new Set(records.filter((record) => record.clockInAt).map((record) => record.attendanceDate));
  const cutoffPassed = zonedParts(now, settings.timezone).minutes > timeToMinutes(settings.workStartTime) + settings.gracePeriodMinutes;
  const absent = eachDate(bounds.from, today).filter((date) => {
    if (!settings.workingDays.includes(isoWeekday(date))) return false;
    if (worked.has(date)) return false;
    if (date === today && !cutoffPassed) return false;
    return true;
  }).length;
  return {
    settings,
    today,
    serverTime: now.toISOString(),
    faceEnrolled: face.rows[0]?.status === 'active',
    faceEnrolledAt: face.rows[0]?.enrolled_at ? new Date(face.rows[0].enrolled_at as string).toISOString() : null,
    todayRecord,
    month: {
      present: records.filter((record) => record.displayStatus === 'present').length,
      late: records.filter((record) => record.displayStatus === 'late').length,
      incomplete: records.filter((record) => record.displayStatus === 'incomplete').length,
      pendingReview: records.filter((record) => record.displayStatus === 'pending_review').length,
      absent,
      workedMinutes: records.reduce((sum, record) => sum + (record.totalMinutes || 0), 0),
    },
    series: eachDate(bounds.from, bounds.to).map((date) => ({
      date,
      minutes: records.find((record) => record.attendanceDate === date)?.totalMinutes || 0,
    })),
    recent: recentRows.rows.map((row) => mapAttendance(row as Record<string, unknown>, settings, now, today)),
    reviews: reviews.rows,
    disclosure: VERIFICATION_DISCLOSURE.summary,
  };
}

async function lockAttendance(client: DbClient, userId: string, date: string) {
  const result = await client.query(
    `SELECT id, clock_in_at, clock_out_at FROM attendance
     WHERE employee_id = $1 AND attendance_date = $2::date AND session_index = 1
     FOR UPDATE`,
    [userId, date],
  );
  const row = result.rows[0] as { id: string; clock_in_at: string | null; clock_out_at: string | null } | undefined;
  return row || null;
}

async function failureCount(client: DbClient, userId: string) {
  const result = await client.query(
    `SELECT count(*)::int AS count FROM verification_attempts
     WHERE employee_id = $1 AND success = false AND created_at > now() - make_interval(mins => $2)`,
    [userId, 15],
  );
  return Number(result.rows[0].count);
}

async function ensureReview(client: DbClient, userId: string, date: string, action: 'in' | 'out', reason: string) {
  try {
    await client.query('SAVEPOINT review_insert');
    await client.query(
      `INSERT INTO manual_reviews (employee_id, attendance_date, requested_action, reason)
       VALUES ($1, $2::date, $3, $4)`,
      [userId, date, action === 'in' ? 'clock_in' : 'clock_out', reason],
    );
    await client.query('RELEASE SAVEPOINT review_insert');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT review_insert');
    const code = (error as { code?: string }).code;
    if (code !== '23505') throw error;
  }
}
