import type { AttendanceRecord, AttendanceSettings, PublicUser } from '@shared/types';

export type DashboardData = {
  settings: AttendanceSettings;
  today: string;
  serverTime: string;
  faceEnrolled: boolean;
  faceEnrolledAt: string | null;
  todayRecord: AttendanceRecord | null;
  month: {
    present: number;
    late: number;
    incomplete: number;
    pendingReview: number;
    absent: number;
    workedMinutes: number;
  };
  series: { date: string; minutes: number }[];
  recent: AttendanceRecord[];
  reviews: Array<{
    id: string;
    requested_action: string;
    reason: string;
    status: string;
    attendance_date: string;
  }>;
  disclosure: string;
};

export type AuthResponse = { token: string; user: PublicUser };
export type { AttendanceRecord, AttendanceSettings, PublicUser };
