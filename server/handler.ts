import { VERIFICATION_DISCLOSURE } from '../shared/types';
import { pool } from './db';
import { apiPath, HttpError, json, mapDbError } from './http';
import { login, logout, me, register, updateProfile } from './routes/auth';
import { createLoginChallenge, faceLogin } from './routes/faceLogin';
import { createChallenge, deleteEnrollment, enrollFace, faceStatus } from './routes/face';
import { clockIn, clockOut, dashboard, history } from './routes/attendance';
import {
  adminAttendance,
  adminAudit,
  adminCorrect,
  adminDeleteFace,
  adminEmployees,
  adminExport,
  adminResolveReview,
  adminReviews,
  adminSettings,
  adminSummary,
  adminCreateEmployee,
  adminUpdateEmployee,
  readSettings,
} from './routes/admin';

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        vary: 'origin',
      },
    });
  }
  try {
    return await route(request);
  } catch (error) {
    const mapped = mapDbError(error);
    if (mapped) return json({ error: mapped.message, code: mapped.code }, mapped.status);
    if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
    console.error(error);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

async function route(request: Request): Promise<Response> {
  const path = apiPath(request);
  const method = request.method.toUpperCase();
  if (method === 'GET' && path === '/health') return health();
  if (method === 'POST' && path === '/auth/register') return register(request);
  if (method === 'POST' && path === '/auth/login') return login(request);
  if (method === 'POST' && path === '/auth/face/challenge') return createLoginChallenge(request);
  if (method === 'POST' && path === '/auth/face') return faceLogin(request);
  if (method === 'POST' && path === '/auth/logout') return logout(request);
  if (method === 'GET' && path === '/auth/me') return me(request);
  if (method === 'PATCH' && path === '/profile') return updateProfile(request);
  if (method === 'GET' && path === '/settings') return readSettings(request);
  if (method === 'POST' && path === '/face/challenge') return createChallenge(request);
  if (method === 'GET' && path === '/face/status') return faceStatus(request);
  if (method === 'POST' && path === '/face/enroll') return enrollFace(request);
  if (method === 'DELETE' && path === '/face/enroll') return deleteEnrollment(request);
  if (method === 'POST' && path === '/attendance/clock-in') return clockIn(request);
  if (method === 'POST' && path === '/attendance/clock-out') return clockOut(request);
  if (method === 'GET' && path === '/dashboard') return dashboard(request);
  if (method === 'GET' && path === '/attendance') return history(request);
  if (method === 'GET' && path === '/admin/summary') return adminSummary(request);
  if (method === 'GET' && path === '/admin/employees') return adminEmployees(request);
  if (method === 'POST' && path === '/admin/employees') return adminCreateEmployee(request);
  if (method === 'GET' && path === '/admin/attendance') return adminAttendance(request);
  if (method === 'PUT' && path === '/admin/attendance') return adminCorrect(request);
  if (method === 'GET' && path === '/admin/reviews') return adminReviews(request);
  if (method === 'GET' && path === '/admin/export') return adminExport(request);
  if (method === 'GET' && path === '/admin/audit') return adminAudit(request);
  if ((method === 'GET' || method === 'PUT') && path === '/admin/settings') return adminSettings(request);

  const employee = path.match(/^\/admin\/employees\/([0-9a-f-]{36})$/i);
  if (employee && method === 'PATCH') return adminUpdateEmployee(request, employee[1]);
  const face = path.match(/^\/admin\/employees\/([0-9a-f-]{36})\/face$/i);
  if (face && method === 'DELETE') return adminDeleteFace(request, face[1]);
  const review = path.match(/^\/admin\/reviews\/([0-9a-f-]{36})$/i);
  if (review && method === 'POST') return adminResolveReview(request, review[1]);

  return json({ error: 'Not found.' }, 404);
}

async function health(): Promise<Response> {
  try {
    await pool.query('SELECT 1 AS ok');
    return json({ ok: true, database: 'up', verification: VERIFICATION_DISCLOSURE });
  } catch {
    return json({ ok: false, database: 'down' }, 503);
  }
}
