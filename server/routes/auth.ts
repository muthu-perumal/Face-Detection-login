import bcrypt from 'bcryptjs';
import { profileSchema, registerSchema, loginSchema } from '../../shared/schemas';
import { withUser } from '../db';
import { audit, getSettings, requireUser } from '../context';
import { clientIp, HttpError, json, parseBody, readJson } from '../http';
import { mapUser } from '../map';
import { signToken } from '../tokens';
import { normalizeDescriptor, storeEnrollment } from './face';

const dummyHash = bcrypt.hashSync('dummy-password-not-used', 10);

function cleanAvatar(value?: string | null): string | null {
  if (!value) return null;
  if (!/^data:image\/(jpeg|png);base64,[a-z0-9+/=\r\n]+$/i.test(value)) {
    throw new HttpError(400, 'Profile photo must be a JPEG or PNG.');
  }
  if (value.length > 200_000) throw new HttpError(400, 'Profile photo is too large.');
  return value;
}

export async function register(request: Request): Promise<Response> {
  const body = parseBody(registerSchema, await readJson(request));
  const avatar = cleanAvatar(body.avatarData);
  const descriptor = body.faceDescriptor?.length ? normalizeDescriptor(body.faceDescriptor) : null;
  const passwordHash = await bcrypt.hash(body.password, 10);
  try {
    const created = await withUser({ id: '', role: 'system' }, async (client) => {
      const settings = await getSettings(client);
      const status = settings.requireAdminApproval ? 'pending' : 'active';
      const inserted = await client.query(
        `INSERT INTO profiles (employee_id, full_name, email, department, designation, role, status, password_hash, avatar_data)
         VALUES ($1, $2, $3, $4, $5, 'employee', $6, $7, $8)
         RETURNING id, employee_id, full_name, email, department, designation, role, status, avatar_data`,
        [body.employeeId, body.fullName, body.email, body.department, body.designation, status, passwordHash, avatar],
      );
      const user = mapUser(inserted.rows[0] as Record<string, unknown>);
      if (descriptor) await storeEnrollment(client, user.id, descriptor, false);
      await audit(client, user.id, 'employee.registered', user.id, { status, face: Boolean(descriptor) });
      return user;
    });
    return json({
      user: created,
      pending: created.status === 'pending',
      message: created.status === 'pending' ? 'Registration received. An administrator must approve the account.' : 'Account created. You can sign in.',
    }, 201);
  } catch (error) {
    throw error;
  }
}

export async function login(request: Request): Promise<Response> {
  const body = parseBody(loginSchema, await readJson(request));
  const email = body.email.toLowerCase();
  const ip = clientIp(request);
  const result = await withUser({ id: '', role: 'system' }, async (client) => {
    const recent = await client.query(
      `SELECT count(*)::int AS count FROM login_attempts
       WHERE email = $1 AND success = false AND created_at > now() - make_interval(mins => 15)`,
      [email],
    );
    if (Number(recent.rows[0].count) >= 8) {
      return { status: 429, body: { error: 'Too many sign-in attempts. Try again in a few minutes.' } };
    }
    const found = await client.query('SELECT * FROM lookup_login($1)', [email]);
    const row = found.rows[0] as Record<string, unknown> | undefined;
    const hash = row ? String(row.password_hash) : dummyHash;
    const matches = await bcrypt.compare(body.password, hash);
    if (!row || !matches) {
      await client.query('INSERT INTO login_attempts (email, success, ip_address) VALUES ($1, false, $2)', [email, ip]);
      return { status: 401, body: { error: 'Invalid email or password.' } };
    }
    if (row.status === 'pending') {
      return { status: 403, body: { error: 'This account is waiting for administrator approval.' } };
    }
    if (row.status !== 'active') {
      return { status: 403, body: { error: 'This account is suspended.' } };
    }
    const session = await client.query(
      `INSERT INTO sessions (user_id, expires_at) VALUES ($1, now() + interval '12 hours') RETURNING id`,
      [row.id],
    );
    await client.query('INSERT INTO login_attempts (email, success, ip_address) VALUES ($1, true, $2)', [email, ip]);
    const user = mapUser(row, String(session.rows[0].id));
    await audit(client, user.id, 'auth.login', user.id, { ip });
    return { status: 200, body: { token: signToken(user.id, user.sid), user } };
  });
  return json(result.body, result.status);
}

export async function logout(request: Request): Promise<Response> {
  const user = await requireUser(request);
  await withUser({ id: user.id, role: user.role }, async (client) => {
    await client.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [user.sid, user.id]);
    await audit(client, user.id, 'auth.logout', user.id);
  });
  return json({ ok: true });
}

export async function me(request: Request): Promise<Response> {
  const user = await requireUser(request);
  return json({ user });
}

export async function updateProfile(request: Request): Promise<Response> {
  const user = await requireUser(request);
  const body = parseBody(profileSchema, await readJson(request));
  const avatar = body.avatarData === undefined ? undefined : cleanAvatar(body.avatarData);
  const updated = await withUser({ id: user.id, role: user.role }, async (client) => {
    let passwordHash: string | null = null;
    if (body.newPassword) {
      if (!body.currentPassword) throw new HttpError(400, 'Current password is required.');
      const current = await client.query('SELECT read_password_hash($1) AS hash', [user.id]);
      const hash = current.rows[0]?.hash ? String(current.rows[0].hash) : '';
      const matches = await bcrypt.compare(body.currentPassword, hash);
      if (!matches) throw new HttpError(400, 'Current password is incorrect.');
      passwordHash = await bcrypt.hash(body.newPassword, 10);
    }
    const result = await client.query(
      `UPDATE profiles
       SET full_name = $2,
           department = $3,
           designation = $4,
           avatar_data = COALESCE($5, avatar_data),
           password_hash = COALESCE($6, password_hash)
       WHERE id = $1
       RETURNING id, employee_id, full_name, email, department, designation, role, status, avatar_data`,
      [user.id, body.fullName, body.department, body.designation, avatar === undefined ? null : avatar, passwordHash],
    );
    if (passwordHash) {
      await client.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [user.id, user.sid]);
    }
    await audit(client, user.id, 'profile.updated', user.id, { passwordChanged: Boolean(passwordHash) });
    return mapUser(result.rows[0] as Record<string, unknown>, user.sid);
  });
  return json({ user: updated });
}
