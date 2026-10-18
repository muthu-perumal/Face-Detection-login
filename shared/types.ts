export const CONSENT_VERSION = '2026-10-18';
export const MODEL_VERSION = 'face-api-recognition-vladmandic-1';
export const TEMPLATE_VERSION = 'v1';
export const MAX_FAILED_VERIFICATIONS = 5;
export const FAILURE_WINDOW_MINUTES = 15;

export const VERIFICATION_DISCLOSURE = {
  id: 'face-api-development',
  productionReady: false,
  summary:
    'This build compares a face-api.js numeric descriptor and checks a short movement challenge. It is not certified biometric identification, and it is not certified presentation-attack detection. A modified client can still forge samples. Use manual review when the result is uncertain.',
};

export type Role = 'employee' | 'admin';
export type AccountStatus = 'pending' | 'active' | 'suspended';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'incomplete' | 'pending_review';
export type VerificationMethod = 'face' | 'manual' | 'admin';
export type ChallengeInstruction = 'turn_left' | 'turn_right' | 'nod';
export type ReenrollPolicy = 'self_service' | 'admin_only' | 'disabled';

export type PublicUser = {
  id: string;
  employeeId: string;
  fullName: string;
  email: string;
  department: string;
  designation: string;
  role: Role;
  status: AccountStatus;
  avatarData: string | null;
};

export type AttendanceSettings = {
  timezone: string;
  workingDays: number[];
  workStartTime: string;
  workEndTime: string;
  gracePeriodMinutes: number;
  lateThresholdMinutes: number;
  faceDistanceThreshold: number;
  allowManualAttendance: boolean;
  requireFaceVerification: boolean;
  requireAdminApproval: boolean;
  faceReenrollPolicy: ReenrollPolicy;
};

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  employeeCode?: string;
  fullName?: string;
  department?: string;
  attendanceDate: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  totalMinutes: number | null;
  status: AttendanceStatus;
  displayStatus: AttendanceStatus;
  verificationMethod: VerificationMethod;
};

export type LandmarkSample = {
  noseX: number;
  noseY: number;
  eyeDX: number;
  t: number;
};
