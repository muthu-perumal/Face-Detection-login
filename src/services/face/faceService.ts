import { api } from '@/lib/api';
import type { ChallengeInstruction } from '@shared/types';
import type { LandmarkSample } from '@shared/types';

export type Challenge = {
  challengeId: string;
  instruction: ChallengeInstruction;
  prompt: string;
  expiresAt: string;
  disclosure: string;
};

export const faceService = {
  challenge: () => api<Challenge>('/face/challenge', { method: 'POST' }),
  status: () => api<{ enrollment: { enrolled: boolean; enrolledAt: string; consentAt: string } | null; disclosure: string }>('/face/status'),
  enroll: (body: { consentAccepted: true; consentVersion: string; challengeId: string; samples: number[][]; landmarks: LandmarkSample[] }) =>
    api<{ message: string }>('/face/enroll', { method: 'POST', body: JSON.stringify(body) }),
  remove: () => api<{ message: string }>('/face/enroll', { method: 'DELETE' }),
};
