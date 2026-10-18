import { describe, expect, test } from 'vitest';
import {
  arrivalStatus,
  assessLiveness,
  euclidean,
  formatDuration,
  minutesBetween,
  samplesAreConsistent,
  zonedTimeToIso,
} from '../shared/attendance';
import type { ChallengeInstruction } from '../shared/types';
import { descriptor, motion } from './helpers';

const settings = { timezone: 'Asia/Kolkata', workStartTime: '09:00', gracePeriodMinutes: 15 };

describe('attendance rules', () => {
  test('formats an 8 hour 35 minute day', () => {
    const start = new Date('2026-10-18T03:40:00.000Z');
    const end = new Date('2026-10-18T12:15:00.000Z');
    expect(minutesBetween(start, end)).toBe(515);
    expect(formatDuration(515)).toBe('08h 35m');
  });

  test('converts company local time to UTC', () => {
    expect(zonedTimeToIso('2026-10-18', '09:10', 'Asia/Kolkata')).toBe('2026-10-18T03:40:00.000Z');
    expect(zonedTimeToIso('2026-10-18', '17:45', 'Asia/Kolkata')).toBe('2026-10-18T12:15:00.000Z');
  });

  test('marks arrivals after the grace period as late', () => {
    expect(arrivalStatus(new Date('2026-10-18T03:40:00.000Z'), settings)).toBe('present');
    expect(arrivalStatus(new Date('2026-10-18T03:50:00.000Z'), settings)).toBe('late');
  });
});

describe('liveness and descriptors', () => {
  test('rejects a still image and accepts the instructed motion', () => {
    const still = Array.from({ length: 10 }, (_, index) => ({ noseX: 0.5, noseY: 0.5, eyeDX: 0.2, t: index }));
    expect(assessLiveness(still, 'turn_left').ok).toBe(false);
    for (const instruction of ['turn_left', 'turn_right', 'nod'] as ChallengeInstruction[]) {
      expect(assessLiveness(motion(instruction), instruction).ok).toBe(true);
    }
  });

  test('matches a repeated descriptor and separates two identities', () => {
    const first = descriptor(0);
    const second = descriptor(1);
    expect(samplesAreConsistent([first, first, first, first])).toBe(true);
    expect(euclidean(first, first)).toBe(0);
    expect(euclidean(first, second)).toBeGreaterThan(0.5);
  });
});

