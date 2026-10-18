import type { DbClient } from './db';
import { HttpError } from './http';
import { mapSettings, mapUser, type SessionUser } from './map';
import { verifyToken } from './tokens';
import { withUser } from './db';
import type { AttendanceSettings } from '../shared/types';

export async function requireUser(request: Request): Promise<SessionUser> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Sign in required.');
  const payload = verifyToken(token);
  return withUser({ id: payload.sub, role: 'employee' }, async (client) => {
    const session = await client.query('SELECT id, expires_at FROM sessions WHERE id = $1 AND user_id = $2', [payload.sid, payload.sub]);
    if (!session.rows[0] || new Date(session.rows[0].expires_at as string) <= new Date()) {
      throw new HttpError(401, 'Session expired.');
    }
    const profile = await client.query(
      `SELECT id, employee_id, full_name, email, department, designation, role, status, avatar_data
       FROM profiles WHERE id = $1`,
      [payload.sub],
    );
    if (!profile.rows[0]) throw new HttpError(401, 'Sign in required.');
    const user = mapUser(profile.rows[0] as Record<string, unknown>, payload.sid);
    if (user.status !== 'active') throw new HttpError(403, 'This account is not active.');
    return user;
  });
}

export function requireAdmin(user: SessionUser): void {
  if (user.role !== 'admin') throw new HttpError(403, 'Administrator access is required.');
}

export async function getSettings(client: DbClient): Promise<AttendanceSettings> {
  const result = await client.query('SELECT * FROM attendance_settings WHERE id = 1');
  if (!result.rows[0]) throw new HttpError(500, 'Attendance settings are not initialized.');
  return mapSettings(result.rows[0] as Record<string, unknown>);
}

export async function serverNow(client: DbClient): Promise<Date> {
  const result = await client.query('SELECT now() AS now');
  return new Date(result.rows[0].now as string);
}

export async function audit(
  client: DbClient,
  actorId: string | null,
  action: string,
  targetId: string | null,
  details?: unknown,
): Promise<void> {
  await client.query('INSERT INTO audit_logs (actor_id, action, target_id, details) VALUES ($1, $2, $3, $4::jsonb)', [
    actorId,
    action,
    targetId,
    details == null ? null : JSON.stringify(details),
  ]);
}
