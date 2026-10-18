import type { AttendanceRecord, AttendanceSettings, AttendanceStatus, PublicUser, VerificationMethod } from '../shared/types';
import { displayStatus } from '../shared/attendance';

export type SessionUser = PublicUser & { sid: string };

export function mapUser(row: Record<string, unknown>, sid = ''): SessionUser {
  return {
    id: String(row.id),
    sid,
    employeeId: String(row.employee_id),
    fullName: String(row.full_name),
    email: String(row.email),
    department: String(row.department),
    designation: String(row.designation),
    role: row.role === 'admin' ? 'admin' : 'employee',
    status: row.status as PublicUser['status'],
    avatarData: row.avatar_data ? String(row.avatar_data) : null,
  };
}

export function mapSettings(row: Record<string, unknown>): AttendanceSettings {
  const start = String(row.work_start_time).slice(0, 5);
  const end = String(row.work_end_time).slice(0, 5);
  return {
    timezone: String(row.timezone),
    workingDays: (row.working_days as number[]).map(Number),
    workStartTime: start,
    workEndTime: end,
    gracePeriodMinutes: Number(row.grace_period_minutes),
    lateThresholdMinutes: Number(row.late_threshold_minutes),
    faceDistanceThreshold: Number(row.face_distance_threshold),
    allowManualAttendance: Boolean(row.allow_manual_attendance),
    requireFaceVerification: Boolean(row.require_face_verification),
    requireAdminApproval: Boolean(row.require_admin_approval),
    faceReenrollPolicy: row.face_reenroll_policy as AttendanceSettings['faceReenrollPolicy'],
  };
}

export function mapAttendance(
  row: Record<string, unknown>,
  settings: Pick<AttendanceSettings, 'timezone' | 'workEndTime'>,
  now: Date,
  today: string,
): AttendanceRecord {
  const record = {
    id: String(row.id),
    employeeId: String(row.employee_id),
    employeeCode: row.employee_code ? String(row.employee_code) : undefined,
    fullName: row.full_name ? String(row.full_name) : undefined,
    department: row.department ? String(row.department) : undefined,
    attendanceDate: String(row.attendance_date).slice(0, 10),
    clockInAt: row.clock_in_at ? new Date(String(row.clock_in_at)).toISOString() : null,
    clockOutAt: row.clock_out_at ? new Date(String(row.clock_out_at)).toISOString() : null,
    totalMinutes: row.total_minutes == null ? null : Number(row.total_minutes),
    status: row.status as AttendanceStatus,
    verificationMethod: row.verification_method as VerificationMethod,
    displayStatus: 'present' as AttendanceStatus,
  };
  record.displayStatus = displayStatus(
    { status: record.status, clockInAt: record.clockInAt, clockOutAt: record.clockOutAt, attendanceDate: record.attendanceDate },
    settings,
    now,
    today,
  );
  return record;
}
