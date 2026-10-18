import { api } from '@/lib/api';
import type { AttendanceRecord, AttendanceSettings } from '@shared/types';
import type { DashboardData } from '@/types';

export const attendanceService = {
  dashboard: () => api<DashboardData>('/dashboard'),
  history: (from: string, to: string, status = '') =>
    api<{ records: AttendanceRecord[]; settings: AttendanceSettings; today: string }>(
      `/attendance?from=${from}&to=${to}&status=${status}`,
    ),
  clockIn: (body: unknown) => api<{ message: string; status?: string; totalMinutes?: number }>('/attendance/clock-in', { method: 'POST', body: JSON.stringify(body) }),
  clockOut: (body: unknown) => api<{ message: string; status?: string; totalMinutes?: number }>('/attendance/clock-out', { method: 'POST', body: JSON.stringify(body) }),
};
