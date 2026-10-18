import { createHmac, timingSafeEqual } from 'crypto';
import { HttpError } from './http';

function secret(): string {
  const value = process.env.JWT_SECRET || '';
  if (value.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  return value;
}

export type TokenPayload = { sub: string; sid: string; exp: number };

export function signToken(sub: string, sid: string): string {
  const body = Buffer.from(JSON.stringify({ sub, sid, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyToken(token: string): TokenPayload {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new HttpError(401, 'Sign in required.');
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new HttpError(401, 'Sign in required.');
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
  } catch {
    throw new HttpError(401, 'Sign in required.');
  }
  if (!payload.sub || !payload.sid || payload.exp < Date.now()) throw new HttpError(401, 'Session expired.');
  return payload;
}
