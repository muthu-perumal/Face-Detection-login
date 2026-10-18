import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}

export function csv(data: string, filename: string): Response {
  return new Response(data, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 800_000) throw new HttpError(413, 'Payload too large.');
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map((issue) => issue.message).join(' '));
  }
  return result.data;
}

export function apiPath(request: Request): string {
  const url = new URL(request.url);
  let path = url.pathname;
  const marker = '/.netlify/functions/api';
  const index = path.indexOf(marker);
  if (index >= 0) path = path.slice(index + marker.length);
  if (path.startsWith('/api')) path = path.slice(4);
  if (!path.startsWith('/')) path = `/${path}`;
  return path.replace(/\/$/, '') || '/';
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  );
}

export function mapDbError(error: unknown): HttpError | null {
  if (error instanceof HttpError) return error;
  const code = (error as { code?: string }).code;
  const constraint = (error as { constraint?: string }).constraint || '';
  const message = error instanceof Error ? error.message : '';
  if (code === '23505') {
    if (constraint.includes('email')) return new HttpError(409, 'An account with this email already exists.');
    if (constraint.includes('face')) return new HttpError(409, 'A face template is already enrolled.');
    if (constraint.includes('one_pending')) return new HttpError(409, 'A review for this day is already pending.');
    if (constraint.includes('employee')) return new HttpError(409, 'This employee ID is already registered.');
    if (constraint.includes('attendance')) return new HttpError(409, 'Attendance for this day already exists.');
    return new HttpError(409, 'This record already exists.');
  }
  if (message.includes('clock out is earlier')) return new HttpError(400, 'Clock out must be after clock in.');
  if (message.includes('Administrators cannot read')) return new HttpError(403, 'Administrators cannot read biometric templates.');
  if (message.includes('Forbidden')) return new HttpError(403, 'You do not have access to that.');
  return null;
}
