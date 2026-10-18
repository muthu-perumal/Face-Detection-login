import bcrypt from 'bcryptjs';
import { arrivalStatus, formatDuration, zonedParts, eachDate, isoWeekday, timeToMinutes } from '../../shared/attendance';
import { adminCreateUserSchema, correctionSchema, employeeAdminSchema, reviewSchema, settingsSchema } from '../../shared/schemas';
import { withUser } from '../db';
import { audit, getSettings, requireAdmin, requireUser, serverNow } from '../context';
import { csv, HttpError, json, parseBody, readJson } from '../http';
import { mapAttendance, mapSettings, mapUser } from '../map';

const ATTENDANCE_SELECT = `
  a.id, a.employee_id, a.attendance_date::text AS attendance_date, a.clock_in_at, a.clock_out_at,
  a.total_minutes, a.status, a.verification_method, p.employee_id AS employee_code, p.full_name, p.department
`;

export async function adminSummary(request: Request): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const summary = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const settings = await getSettings(client);
    const now = await serverNow(client);
    const today = zonedParts(now, settings.timezone).date;
    const people = await client.query(`SELECT id, status FROM profiles`);
    const activeIds = people.rows.filter((row) => row.status === 'active').map((row) => String(row.id));
    const todayRows = await client.query(
      `SELECT ${ATTENDANCE_SELECT}
       FROM attendance a JOIN profiles p ON p.id = a.employee_id
       WHERE a.attendance_date = $1::date`,
      [today],
    );
    const records = todayRows.rows.map((row) => mapAttendance(row as Record<string, unknown>, settings, now, today));
    const clocked = new Set(records.filter((record) => record.clockInAt).map((record) => record.employeeId));
    const workingToday = settings.workingDays.includes(isoWeekday(today));
    const cutoffPassed = workingToday && zonedParts(now, settings.timezone).minutes > timeToMinutes(settings.workStartTime) + settings.gracePeriodMinutes;
    const from = eachDate(shiftDate(today, -13), today);
    const seriesRows = await client.query(
      `SELECT attendance_date::text AS attendance_date, status, clock_in_at, clock_out_at
       FROM attendance WHERE attendance_date BETWEEN $1::date AND $2::date`,
      [from[0], today],
    );
    const reviews = await client.query(`SELECT count(*)::int AS count FROM manual_reviews WHERE status = 'pending'`);
    return {
      totalEmployees: people.rows.length,
      activeEmployees: activeIds.length,
      presentToday: records.filter((record) => record.displayStatus === 'present').length,
      lateToday: records.filter((record) => record.displayStatus === 'late').length,
      incompleteToday: records.filter((record) => record.displayStatus === 'incomplete').length,
      clockedIn: records.filter((record) => record.clockInAt && !record.clockOutAt && record.displayStatus !== 'incomplete').length,
      yetToClockIn: workingToday && !cutoffPassed ? activeIds.filter((id) => !clocked.has(id)).length : 0,
      absentToday: workingToday && cutoffPassed ? activeIds.filter((id) => !clocked.has(id)).length : 0,
      pendingReviews: Number(reviews.rows[0].count),
      series: from.map((date) => {
        const day = seriesRows.rows.filter((row) => String(row.attendance_date).slice(0, 10) === date);
        return {
          date,
          present: day.filter((row) => row.status === 'present').length,
          late: day.filter((row) => row.status === 'late').length,
          incomplete: day.filter((row) => row.clock_in_at && !row.clock_out_at).length,
        };
      }),
      settings,
      today,
    };
  });
  return json(summary);
}

export async function adminEmployees(request: Request): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  const like = `%${query.replace(/[%_]/g, '')}%`;
  const data = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const result = await client.query(
      `SELECT id, employee_id, full_name, email, department, designation, role, status, created_at
       FROM profiles
       WHERE $1 = '' OR full_name ILIKE $2 OR email ILIKE $2 OR employee_id ILIKE $2
       ORDER BY full_name ASC
       LIMIT 200`,
      [query, like],
    );
    const enrolled = await client.query('SELECT * FROM list_enrollment_status()');
    const enrolledIds = new Set(enrolled.rows.map((row) => String(row.employee_id)));
    return result.rows.map((row) => ({
      ...mapUser(row as Record<string, unknown>),
      createdAt: new Date(row.created_at as string).toISOString(),
      faceEnrolled: enrolledIds.has(String(row.id)),
    }));
  });
  return json({ employees: data });
}

export async function adminCreateEmployee(request: Request): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const body = parseBody(adminCreateUserSchema, await readJson(request));
  const passwordHash = await bcrypt.hash(body.password, 10);
  const created = await withUser({ id: user.id, role: 'system' }, async (client) => {
    const inserted = await client.query(
      `INSERT INTO profiles (employee_id, full_name, email, department, designation, role, status, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
       RETURNING id, employee_id, full_name, email, department, designation, role, status, avatar_data`,
      [body.employeeId, body.fullName, body.email, body.department, body.designation, body.role, passwordHash],
    );
    const employee = mapUser(inserted.rows[0] as Record<string, unknown>);
    await audit(client, user.id, 'employee.created', employee.id, { role: employee.role, employeeId: employee.employeeId });
    return employee;
  });
  return json({ user: created, message: 'Account created. The person can sign in now.' }, 201);
}

export async function adminUpdateEmployee(request: Request, employeeId: string): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const body = parseBody(employeeAdminSchema, await readJson(request));
  const updated = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    if (employeeId === user.id && (body.role === 'employee' || body.status === 'suspended' || body.status === 'pending')) {
      const admins = await client.query(`SELECT count(*)::int AS count FROM profiles WHERE role = 'admin' AND status = 'active'`);
      if (Number(admins.rows[0].count) <= 1) throw new HttpError(400, 'The last active administrator cannot be removed.');
    }
    const current = await client.query(
      `SELECT id, employee_id, full_name, email, department, designation, role, status, avatar_data FROM profiles WHERE id = $1`,
      [employeeId],
    );
    if (!current.rows[0]) throw new HttpError(404, 'Employee not found.');
    const result = await client.query(
      `UPDATE profiles
       SET role = COALESCE($2, role),
           status = COALESCE($3, status),
           department = COALESCE($4, department),
           designation = COALESCE($5, designation)
       WHERE id = $1
       RETURNING id, employee_id, full_name, email, department, designation, role, status, avatar_data`,
      [employeeId, body.role ?? null, body.status ?? null, body.department ?? null, body.designation ?? null],
    );
    await audit(client, user.id, 'employee.updated', employeeId, { before: mapUser(current.rows[0] as Record<string, unknown>), after: body });
    return mapUser(result.rows[0] as Record<string, unknown>);
  });
  return json({ user: updated });
}

export async function adminDeleteFace(request: Request, employeeId: string): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const removed = await client.query('DELETE FROM face_enrollments WHERE employee_id = $1 RETURNING id', [employeeId]);
    if (!removed.rows[0]) throw new HttpError(404, 'No face enrollment was found.');
    await audit(client, user.id, 'face.deleted_by_admin', employeeId);
  });
  return json({ ok: true });
}

export async function adminAttendance(request: Request): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const url = new URL(request.url);
  const data = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const settings = await getSettings(client);
    const now = await serverNow(client);
    const today = zonedParts(now, settings.timezone).date;
    const date = url.searchParams.get('date') || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Choose a valid date.');
    const result = await client.query(
      `SELECT ${ATTENDANCE_SELECT}
       FROM attendance a JOIN profiles p ON p.id = a.employee_id
       WHERE a.attendance_date = $1::date
       ORDER BY p.full_name ASC`,
      [date],
    );
    return { date, records: result.rows.map((row) => mapAttendance(row as Record<string, unknown>, settings, now, today)) };
  });
  return json(data);
}

export async function adminCorrect(request: Request): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const body = parseBody(correctionSchema, await readJson(request));
  const record = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const settings = await getSettings(client);
    const person = await client.query('SELECT id FROM profiles WHERE id = $1', [body.employeeId]);
    if (!person.rows[0]) throw new HttpError(404, 'Employee not found.');
    if (body.clockInAt) assertOnDate(body.clockInAt, body.attendanceDate, settings.timezone, 'Clock in');
    if (body.clockOutAt) assertOnDate(body.clockOutAt, body.attendanceDate, settings.timezone, 'Clock out');
    if (body.clockInAt && body.clockOutAt && new Date(body.clockOutAt) < new Date(body.clockInAt)) {
      throw new HttpError(400, 'Clock out must be after clock in.');
    }
    const existing = await client.query(
      `SELECT ${ATTENDANCE_SELECT}
       FROM attendance a JOIN profiles p ON p.id = a.employee_id
       WHERE a.employee_id = $1 AND a.attendance_date = $2::date AND a.session_index = 1
       FOR UPDATE OF a`,
      [body.employeeId, body.attendanceDate],
    );
    let saved;
    if (!existing.rows[0]) {
      saved = await client.query(
        `INSERT INTO attendance (employee_id, attendance_date, clock_in_at, clock_out_at, status, verification_method, session_index)
         VALUES ($1, $2::date, $3, $4, $5, 'admin', 1)
         RETURNING id`,
        [body.employeeId, body.attendanceDate, body.clockInAt ?? null, body.clockOutAt ?? null, body.status],
      );
    } else {
      saved = await client.query(
        `UPDATE attendance
         SET clock_in_at = $2, clock_out_at = $3, status = $4, verification_method = 'admin'
         WHERE id = $1
         RETURNING id`,
        [existing.rows[0].id, body.clockInAt ?? null, body.clockOutAt ?? null, body.status],
      );
    }
    await client.query(
      `INSERT INTO attendance_events (attendance_id, employee_id, event_type, verification_reference)
       VALUES ($1, $2, 'admin_correction', $3)`,
      [saved.rows[0].id, body.employeeId, body.note],
    );
    await audit(client, user.id, 'attendance.corrected', String(saved.rows[0].id), {
      note: body.note,
      before: existing.rows[0] || null,
      after: body,
    });
    const fresh = await client.query(
      `SELECT ${ATTENDANCE_SELECT}
       FROM attendance a JOIN profiles p ON p.id = a.employee_id
       WHERE a.id = $1`,
      [saved.rows[0].id],
    );
    const now = await serverNow(client);
    const today = zonedParts(now, settings.timezone).date;
    return mapAttendance(fresh.rows[0] as Record<string, unknown>, settings, now, today);
  });
  return json({ record, total: formatDuration(record.totalMinutes) });
}

export async function adminReviews(request: Request): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const reviews = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const result = await client.query(
      `SELECT r.id, r.employee_id, r.attendance_date::text AS attendance_date, r.requested_action, r.reason,
              r.status, r.resolution_note, r.created_at, r.resolved_at, p.full_name, p.employee_id AS employee_code
       FROM manual_reviews r JOIN profiles p ON p.id = r.employee_id
       ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at DESC
       LIMIT 200`,
    );
    return result.rows;
  });
  return json({ reviews });
}

export async function adminResolveReview(request: Request, reviewId: string): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const body = parseBody(reviewSchema, await readJson(request));
  const result = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const reviewResult = await client.query(
      `SELECT id, employee_id, attendance_date::text AS attendance_date, requested_action, status, created_at
       FROM manual_reviews WHERE id = $1 FOR UPDATE`,
      [reviewId],
    );
    const review = reviewResult.rows[0] as Record<string, unknown> | undefined;
    if (!review) throw new HttpError(404, 'Review not found.');
    if (review.status !== 'pending') throw new HttpError(409, 'This review is already resolved.');
    if (body.decision === 'rejected') {
      await client.query(
        `UPDATE manual_reviews SET status = 'rejected', reviewer_id = $2, resolution_note = $3, resolved_at = now() WHERE id = $1`,
        [reviewId, user.id, body.note],
      );
      await audit(client, user.id, 'review.rejected', reviewId, { note: body.note });
      return { ok: true };
    }
    const settings = await getSettings(client);
    const employeeId = String(review.employee_id);
    const date = String(review.attendance_date).slice(0, 10);
    const at = new Date(review.created_at as string).toISOString();
    const existing = await client.query(
      `SELECT id, clock_in_at, clock_out_at, status FROM attendance
       WHERE employee_id = $1 AND attendance_date = $2::date AND session_index = 1 FOR UPDATE`,
      [employeeId, date],
    );
    const row = existing.rows[0] as Record<string, unknown> | undefined;
    if (review.requested_action === 'clock_in') {
      if (row?.clock_in_at) throw new HttpError(409, 'This employee already has a clock-in for that day.');
      const status = arrivalStatus(new Date(at), settings);
      if (!row) {
        await client.query(
          `INSERT INTO attendance (employee_id, attendance_date, clock_in_at, status, verification_method, session_index)
           VALUES ($1, $2::date, $3, $4, 'admin', 1)`,
          [employeeId, date, at, status],
        );
      } else {
        await client.query(
          `UPDATE attendance SET clock_in_at = $2, status = $3, verification_method = 'admin' WHERE id = $1`,
          [row.id, at, status],
        );
      }
    } else {
      if (!row?.clock_in_at) throw new HttpError(409, 'Clock out cannot be approved without a clock-in.');
      if (row.clock_out_at) throw new HttpError(409, 'This employee already clocked out.');
      await client.query(`UPDATE attendance SET clock_out_at = $2, verification_method = 'admin' WHERE id = $1`, [row.id, at]);
    }
    await client.query(
      `UPDATE manual_reviews SET status = 'approved', reviewer_id = $2, resolution_note = $3, resolved_at = now() WHERE id = $1`,
      [reviewId, user.id, body.note],
    );
    await audit(client, user.id, 'review.approved', reviewId, { note: body.note, action: review.requested_action });
    return { ok: true };
  });
  return json(result);
}

export async function adminSettings(request: Request): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  if (request.method === 'GET') {
    const settings = await withUser({ id: user.id, role: 'admin' }, (client) => getSettings(client));
    return json({ settings });
  }
  const body = parseBody(settingsSchema, await readJson(request));
  try {
    Intl.DateTimeFormat('en-US', { timeZone: body.timezone }).format(new Date());
  } catch {
    throw new HttpError(400, 'Choose a valid IANA timezone.');
  }
  if (timeToMinutes(body.workEndTime) <= timeToMinutes(body.workStartTime)) {
    throw new HttpError(400, 'Working end time must be after the start time.');
  }
  const settings = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const result = await client.query(
      `UPDATE attendance_settings SET
         timezone = $1,
         working_days = $2::int[],
         work_start_time = $3::time,
         work_end_time = $4::time,
         grace_period_minutes = $5,
         late_threshold_minutes = $6,
         face_distance_threshold = $7,
         allow_manual_attendance = $8,
         require_face_verification = $9,
         require_admin_approval = $10,
         face_reenroll_policy = $11
       WHERE id = 1
       RETURNING *`,
      [
        body.timezone,
        body.workingDays,
        body.workStartTime,
        body.workEndTime,
        body.gracePeriodMinutes,
        body.lateThresholdMinutes,
        body.faceDistanceThreshold,
        body.allowManualAttendance,
        body.requireFaceVerification,
        body.requireAdminApproval,
        body.faceReenrollPolicy,
      ],
    );
    await audit(client, user.id, 'settings.updated', '1', body);
    return mapSettings(result.rows[0] as Record<string, unknown>);
  });
  return json({ settings });
}

export async function adminExport(request: Request): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const url = new URL(request.url);
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HttpError(400, 'Choose a valid date range.');
  }
  const text = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const settings = await getSettings(client);
    const now = await serverNow(client);
    const today = zonedParts(now, settings.timezone).date;
    const result = await client.query(
      `SELECT ${ATTENDANCE_SELECT}
       FROM attendance a JOIN profiles p ON p.id = a.employee_id
       WHERE a.attendance_date BETWEEN $1::date AND $2::date
       ORDER BY a.attendance_date ASC, p.full_name ASC`,
      [from, to],
    );
    const lines = [
      ['employee_id', 'name', 'department', 'date', 'clock_in', 'clock_out', 'total_hours', 'status', 'method'].join(','),
    ];
    for (const row of result.rows) {
      const record = mapAttendance(row as Record<string, unknown>, settings, now, today);
      lines.push(
        [
          record.employeeCode,
          record.fullName,
          record.department,
          record.attendanceDate,
          record.clockInAt,
          record.clockOutAt,
          formatDuration(record.totalMinutes),
          record.displayStatus,
          record.verificationMethod,
        ].map(cell).join(','),
      );
    }
    await audit(client, user.id, 'report.exported', null, { from, to, rows: result.rows.length });
    return lines.join('\n');
  });
  return csv(text, `attendance-${from}-to-${to}.csv`);
}

export async function adminAudit(request: Request): Promise<Response> {
  const user = await requireUser(request);
  requireAdmin(user);
  const logs = await withUser({ id: user.id, role: 'admin' }, async (client) => {
    const result = await client.query(
      `SELECT a.id, a.actor_id, a.action, a.target_id, a.details, a.created_at, p.full_name AS actor_name
       FROM audit_logs a LEFT JOIN profiles p ON p.id = a.actor_id
       ORDER BY a.created_at DESC LIMIT 100`,
    );
    return result.rows;
  });
  return json({ logs });
}

export async function readSettings(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const settings = await withUser({ id: user.id, role: user.role }, (client) => getSettings(client));
  return json({ settings });
}

function assertOnDate(iso: string, date: string, timeZone: string, label: string) {
  if (zonedParts(new Date(iso), timeZone).date !== date) {
    throw new HttpError(400, `${label} must fall on the selected attendance date in the company timezone.`);
  }
}

function shiftDate(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

function cell(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
