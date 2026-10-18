export class ApiError extends Error {
  status: number;
  details: Record<string, unknown>;

  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const TOKEN_KEY = 'attendance.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...init, headers });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (response.status === 401 && !path.startsWith('/auth/')) {
    setToken(null);
    if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
  }
  if (!response.ok) {
    throw new ApiError(String(data.error || 'Request failed'), response.status, data);
  }
  return data as T;
}
