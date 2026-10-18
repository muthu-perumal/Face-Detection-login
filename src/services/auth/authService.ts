import { api } from '@/lib/api';
import type { PublicUser } from '@shared/types';

export const authService = {
  register: (body: unknown) => api<{ user: PublicUser; pending: boolean; message: string }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  me: () => api<{ user: PublicUser }>('/auth/me'),
};
