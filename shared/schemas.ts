import { z } from 'zod';

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(80),
    employeeId: z
      .string()
      .trim()
      .min(2, 'Enter an employee ID')
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dashes, or underscores'),
    email: z.string().trim().email('Enter a valid email').max(120),
    department: z.string().trim().min(2, 'Enter a department').max(60),
    designation: z.string().trim().min(2, 'Enter a designation').max(60),
    password: z.string().min(8, 'Use at least 8 characters').max(72),
    confirmPassword: z.string(),
    avatarData: z.string().max(200_000).optional().nullable(),
    faceDescriptor: z.array(z.number()).length(128).optional().nullable(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password').max(72),
});

export const adminCreateUserSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter a full name').max(80),
    employeeId: z
      .string()
      .trim()
      .min(2, 'Enter an employee ID')
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dashes, or underscores'),
    email: z.string().trim().email('Enter a valid email').max(120),
    department: z.string().trim().min(2, 'Enter a department').max(60),
    designation: z.string().trim().min(2, 'Enter a designation').max(60),
    password: z.string().min(8, 'Use at least 8 characters').max(72),
    confirmPassword: z.string(),
    role: z.enum(['employee', 'admin']),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  department: z.string().trim().min(2).max(60),
  designation: z.string().trim().min(2).max(60),
  avatarData: z.string().max(200_000).nullable().optional(),
  currentPassword: z.string().max(72).optional(),
  newPassword: z.string().min(8).max(72).optional().or(z.literal('')),
});

export const landmarkSchema = z.object({
  noseX: z.number(),
  noseY: z.number(),
  eyeDX: z.number(),
  t: z.number(),
});

export const facePayloadSchema = z.object({
  method: z.enum(['face', 'manual']).default('face'),
  challengeId: z.string().uuid().optional(),
  samples: z.array(z.array(z.number())).max(8).optional(),
  landmarks: z.array(landmarkSchema).max(48).optional(),
});

export const faceLoginSchema = z.object({
  challengeId: z.string().uuid(),
  samples: z.array(z.array(z.number())).min(3).max(8),
  landmarks: z.array(landmarkSchema).min(8).max(48),
});

export const photoEnrollSchema = z.object({
  consentAccepted: z.literal(true, { errorMap: () => ({ message: 'Consent is required before enrollment' }) }),
  consentVersion: z.string().min(1).max(40),
  descriptor: z.array(z.number()).length(128),
});

export const enrollSchema = z.object({
  consentAccepted: z.literal(true, { errorMap: () => ({ message: 'Consent is required before enrollment' }) }),
  consentVersion: z.string().min(1).max(40),
  challengeId: z.string().uuid(),
  samples: z.array(z.array(z.number())).min(3).max(8),
  landmarks: z.array(landmarkSchema).min(8).max(48),
});

export const settingsSchema = z.object({
  timezone: z.string().min(1).max(80),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1),
  workStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  workEndTime: z.string().regex(/^\d{2}:\d{2}$/),
  gracePeriodMinutes: z.number().int().min(0).max(180),
  lateThresholdMinutes: z.number().int().min(0).max(180),
  faceDistanceThreshold: z.number().min(0.2).max(1.2),
  allowManualAttendance: z.boolean(),
  requireFaceVerification: z.boolean(),
  requireAdminApproval: z.boolean(),
  faceReenrollPolicy: z.enum(['self_service', 'admin_only', 'disabled']),
});

export const correctionSchema = z.object({
  employeeId: z.string().uuid(),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clockInAt: z.string().datetime().nullable().optional(),
  clockOutAt: z.string().datetime().nullable().optional(),
  status: z.enum(['present', 'late', 'absent', 'incomplete', 'pending_review']),
  note: z.string().trim().min(3, 'Add a short reason for the correction').max(500),
});

export const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().min(3).max(500),
});

export const employeeAdminSchema = z.object({
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  role: z.enum(['employee', 'admin']).optional(),
  department: z.string().trim().min(2).max(60).optional(),
  designation: z.string().trim().min(2).max(60).optional(),
});
