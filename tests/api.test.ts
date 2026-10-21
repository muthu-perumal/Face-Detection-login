import { afterAll, beforeAll, expect, test } from 'vitest';
import { handleRequest } from '../server/handler';
import { closePool, pool } from '../server/db';
import type { AttendanceSettings } from '../shared/types';
import { descriptor, motion } from './helpers';
import { zonedTimeToIso } from '../shared/attendance';

let adminToken = '';
let original: AttendanceSettings;

async function call(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await handleRequest(
    new Request(`http://localhost/api${path}`, {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
  return { status: response.status, json: (await response.json()) as Record<string, any> };
}

beforeAll(async () => {
  const health = await call('/health');
  expect(health.status).toBe(200);
  const login = await call('/auth/login', {
    method: 'POST',
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  expect(login.status).toBe(200);
  adminToken = login.json.token;
  original = (await call('/admin/settings', { token: adminToken })).json.settings;
});

afterAll(async () => {
  if (adminToken && original) {
    await call('/admin/settings', { method: 'PUT', token: adminToken, body: original });
  }
  await pool.query(`DELETE FROM profiles WHERE email LIKE 'vitest-%@example.com'`);
  await closePool();
});

test('registration, login, and duplicate accounts', async () => {
  const stamp = Date.now();
  const body = account(stamp);
  const created = await call('/auth/register', { method: 'POST', body: { ...body, role: 'admin' } });
  expect(created.status).toBe(201);
  expect(created.json.user.role).toBe('employee');
  const login = await call('/auth/login', { method: 'POST', body: { email: body.email, password: body.password } });
  expect(login.status).toBe(200);
  const again = await call('/auth/me', { token: login.json.token });
  expect(again.status).toBe(200);
  expect(again.json.user.email).toBe(body.email);
  expect(await call('/auth/register', { method: 'POST', body })).toMatchObject({ status: 409 });
  expect(await call('/auth/register', { method: 'POST', body: { ...account(stamp + 1), email: body.email } })).toMatchObject({ status: 409 });
  expect((await call('/auth/login', { method: 'POST', body: { email: body.email, password: 'wrong-password' } })).status).toBe(401);
});

test('attendance is authenticated, personal, and calculated on the server', async () => {
  const first = await registerAndLogin('a');
  const second = await registerAndLogin('b');
  expect((await call('/attendance/clock-in', { method: 'POST', body: { method: 'manual' } })).status).toBe(401);
  expect((await call('/admin/summary', { token: first.token })).status).toBe(403);

  const manual = await call('/attendance/clock-in', { method: 'POST', token: first.token, body: { method: 'manual', employeeId: second.user.id } });
  expect(manual.status).toBe(202);

  const enrolled = await enroll(first.token, descriptor(3));
  expect(enrolled.status).toBe(200);
  expect(JSON.stringify(enrolled.json)).not.toContain('encrypted_template');

  const still = await verify(first.token, '/attendance/clock-in', descriptor(3), 'still');
  expect(still.status).toBe(401);

  const mismatch = await verify(first.token, '/attendance/clock-in', descriptor(4), 'live');
  expect(mismatch.status).toBe(401);

  const clockIn = await verify(first.token, '/attendance/clock-in', descriptor(3), 'live');
  expect(clockIn.status).toBe(200);
  expect(clockIn.json.message).toContain('Clock In completed at');
  expect((await verify(first.token, '/attendance/clock-in', descriptor(3), 'live')).status).toBe(409);

  const clockOut = await verify(first.token, '/attendance/clock-out', descriptor(3), 'live');
  expect(clockOut.status).toBe(200);
  expect(clockOut.json.message).toContain('Clock Out successful');
  expect(clockOut.json.totalMinutes).toBeGreaterThanOrEqual(0);

  const otherHistory = await call(`/attendance?from=2026-01-01&to=2026-12-31`, { token: second.token });
  expect(otherHistory.json.records.some((record: { employeeId: string }) => record.employeeId === first.user.id)).toBe(false);

  const challenge = await call('/face/challenge', { method: 'POST', token: first.token });
  const replay = await call('/face/enroll', {
    method: 'POST',
    token: first.token,
    body: {
      consentAccepted: true,
      consentVersion: '2026-10-18',
      challengeId: challenge.json.challengeId,
      samples: [descriptor(3), descriptor(3), descriptor(3)],
      landmarks: motion(challenge.json.instruction),
    },
  });
  const replayAgain = await call('/face/enroll', {
    method: 'POST',
    token: first.token,
    body: {
      consentAccepted: true,
      consentVersion: '2026-10-18',
      challengeId: challenge.json.challengeId,
      samples: [descriptor(3), descriptor(3), descriptor(3)],
      landmarks: motion(challenge.json.instruction),
    },
  });
  expect(replay.status).toBe(200);
  expect(replayAgain.status).toBe(401);

  const corrected = await call('/admin/attendance', {
    method: 'PUT',
    token: adminToken,
    body: {
      employeeId: second.user.id,
      attendanceDate: '2026-10-18',
      clockInAt: zonedTimeToIso('2026-10-18', '09:10', 'Asia/Kolkata'),
      clockOutAt: zonedTimeToIso('2026-10-18', '17:45', 'Asia/Kolkata'),
      status: 'present',
      note: 'Duration check',
    },
  });
  expect(corrected.status).toBe(200);
  expect(corrected.json.record.totalMinutes).toBe(515);
  expect(corrected.json.total).toBe('08h 35m');

  const employees = await call('/admin/employees', { token: adminToken });
  expect(JSON.stringify(employees.json)).not.toContain('encrypted_template');
  expect(JSON.stringify(employees.json)).not.toContain('password_hash');
});

test('a face photo saved at registration can sign in', async () => {
  const body = { ...account(Date.now() + 70), faceDescriptor: descriptor(15) };
  const created = await call('/auth/register', { method: 'POST', body });
  expect(created.status).toBe(201);
  const signedIn = await faceSignIn(descriptor(15));
  expect(signedIn.status).toBe(200);
  expect(signedIn.json.user.email).toBe(body.email);
  expect(signedIn.json.action).toBe('clock_in');
});

test('face sign-in clocks in, then clocks out the same day', async () => {
  const person = await registerAndLogin('f');
  expect((await enroll(person.token, descriptor(11))).status).toBe(200);

  const first = await faceSignIn(descriptor(11));
  expect(first.status).toBe(200);
  expect(first.json.action).toBe('clock_in');
  expect(first.json.user.id).toBe(person.user.id);
  expect((await call('/auth/me', { token: first.json.token })).status).toBe(200);

  const second = await faceSignIn(descriptor(11));
  expect(second.status).toBe(200);
  expect(second.json.action).toBe('clock_out');

  const third = await faceSignIn(descriptor(11));
  expect(third.status).toBe(200);
  expect(third.json.action).toBe('already_complete');

  const stranger = await faceSignIn(descriptor(12));
  expect(stranger.status).toBe(401);
});

test('an administrator can create an account that can sign in', async () => {
  const stamp = Date.now();
  const body = { ...account(stamp + 40), role: 'employee' as const };
  expect((await call('/admin/employees', { method: 'POST', body })).status).toBe(401);
  const created = await call('/admin/employees', { method: 'POST', token: adminToken, body });
  expect(created.status).toBe(201);
  expect(created.json.user.role).toBe('employee');
  expect(created.json.user.status).toBe('active');
  expect(JSON.stringify(created.json)).not.toContain('password_hash');
  const signedIn = await call('/auth/login', { method: 'POST', body: { email: body.email, password: body.password } });
  expect(signedIn.status).toBe(200);
});

test('new accounts can require administrator approval', async () => {
  await call('/admin/settings', { method: 'PUT', token: adminToken, body: { ...original, requireAdminApproval: true } });
  const body = account(Date.now() + 20);
  const created = await call('/auth/register', { method: 'POST', body });
  expect(created.json.user.status).toBe('pending');
  expect((await call('/auth/login', { method: 'POST', body: { email: body.email, password: body.password } })).status).toBe(403);
  const approved = await call(`/admin/employees/${created.json.user.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'active' },
  });
  expect(approved.status).toBe(200);
  expect((await call('/auth/login', { method: 'POST', body: { email: body.email, password: body.password } })).status).toBe(200);
});

function account(stamp: number) {
  return {
    fullName: 'Vitest Employee',
    employeeId: `V${stamp}`.slice(0, 32),
    email: `vitest-${stamp}@example.com`,
    department: 'Quality',
    designation: 'Tester',
    password: 'test-password-1',
    confirmPassword: 'test-password-1',
  };
}

async function registerAndLogin(label: string) {
  const body = account(Date.now() + label.charCodeAt(0));
  const created = await call('/auth/register', { method: 'POST', body });
  expect(created.status).toBe(201);
  const login = await call('/auth/login', { method: 'POST', body: { email: body.email, password: body.password } });
  expect(login.status).toBe(200);
  return { token: login.json.token as string, user: login.json.user as { id: string } };
}

async function enroll(token: string, sample: number[]) {
  const challenge = await call('/face/challenge', { method: 'POST', token });
  return call('/face/enroll', {
    method: 'POST',
    token,
    body: {
      consentAccepted: true,
      consentVersion: '2026-10-18',
      challengeId: challenge.json.challengeId,
      samples: [sample, sample, sample, sample],
      landmarks: motion(challenge.json.instruction),
    },
  });
}

async function faceSignIn(sample: number[]) {
  const challenge = await call('/auth/face/challenge', { method: 'POST' });
  expect(challenge.status).toBe(200);
  return call('/auth/face', {
    method: 'POST',
    body: {
      challengeId: challenge.json.challengeId,
      samples: [sample, sample, sample, sample],
      landmarks: motion(challenge.json.instruction),
    },
  });
}

async function verify(token: string, path: string, sample: number[], kind: 'live' | 'still') {
  const challenge = await call('/face/challenge', { method: 'POST', token });
  const landmarks = kind === 'still'
    ? Array.from({ length: 10 }, (_, index) => ({ noseX: 0.5, noseY: 0.5, eyeDX: 0.2, t: index }))
    : motion(challenge.json.instruction);
  return call(path, {
    method: 'POST',
    token,
    body: { method: 'face', challengeId: challenge.json.challengeId, samples: [sample, sample, sample, sample], landmarks },
  });
}
