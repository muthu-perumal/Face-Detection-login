import type { AttendanceSettings, AttendanceStatus, ChallengeInstruction, LandmarkSample } from './types';

export const CHALLENGE_COPY: Record<ChallengeInstruction, string> = {
  turn_left: 'Slowly turn your head to your left',
  turn_right: 'Slowly turn your head to your right',
  nod: 'Slowly nod your head downward',
};

export function euclidean(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    throw new Error('Descriptor length mismatch');
  }
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

export function averageDescriptor(samples: number[][]): number[] {
  if (samples.length === 0) throw new Error('No face samples');
  const width = samples[0].length;
  const average = new Array<number>(width).fill(0);
  for (const sample of samples) {
    if (sample.length !== width) throw new Error('Descriptor length mismatch');
    for (let index = 0; index < width; index += 1) {
      if (!Number.isFinite(sample[index])) throw new Error('Invalid descriptor');
      average[index] += sample[index];
    }
  }
  for (let index = 0; index < width; index += 1) average[index] /= samples.length;
  const norm = Math.hypot(...average);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid descriptor');
  return average.map((value) => value / norm);
}

export function samplesAreConsistent(samples: number[][], limit = 0.42): boolean {
  const average = averageDescriptor(samples);
  return samples.every((sample) => euclidean(sample, average) <= limit);
}

export function assessLiveness(
  samples: LandmarkSample[],
  instruction: ChallengeInstruction,
): { ok: boolean; reason: string; movement: number } {
  if (!Array.isArray(samples) || samples.length < 8) {
    return { ok: false, reason: 'Complete the on-screen motion so a live face can be confirmed.', movement: 0 };
  }
  if (samples.length > 48) {
    return { ok: false, reason: 'Too many motion samples were submitted.', movement: 0 };
  }

  for (const sample of samples) {
    const values = [sample.noseX, sample.noseY, sample.eyeDX, sample.t];
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      return { ok: false, reason: 'Motion samples were invalid.', movement: 0 };
    }
    if (sample.noseX < 0 || sample.noseX > 1 || sample.noseY < 0 || sample.noseY > 1) {
      return { ok: false, reason: 'Motion samples were out of range.', movement: 0 };
    }
  }

  const xs = samples.map((sample) => sample.noseX);
  const ys = samples.map((sample) => sample.noseY);
  const startX = average(xs.slice(0, 3));
  const endX = average(xs.slice(-3));
  const startY = average(ys.slice(0, 3));
  const endY = average(ys.slice(-3));
  const dx = endX - startX;
  const dy = endY - startY;
  const spread = variance(xs) + variance(ys);

  if (spread < 0.00004) {
    return {
      ok: false,
      reason: 'No live movement was detected. A still photo cannot be used for verification.',
      movement: 0,
    };
  }

  if (instruction === 'turn_left' && dx > -0.012) {
    return { ok: false, reason: 'Turn your head to your left, toward the arrow, then hold still.', movement: Math.abs(dx) };
  }
  if (instruction === 'turn_right' && dx < 0.012) {
    return { ok: false, reason: 'Turn your head to your right, toward the arrow, then hold still.', movement: Math.abs(dx) };
  }
  if (instruction === 'nod' && dy < 0.012) {
    return { ok: false, reason: 'Nod your head downward, following the arrow.', movement: Math.abs(dy) };
  }

  return {
    ok: true,
    reason: 'Movement challenge accepted.',
    movement: instruction === 'nod' ? Math.abs(dy) : Math.abs(dx),
  };
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}h ${String(rest).padStart(2, '0')}m`;
}

export function formatClock(date: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return formatted.replace(/\b(am|pm)\b/gi, (value) => value.toUpperCase());
}

export function zonedParts(date: Date, timeZone: string): { date: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

export function zonedTimeToIso(date: string, time: string, timeZone: string): string {
  const [hour, minute] = time.slice(0, 5).split(':').map(Number);
  const desired = hour * 60 + minute;
  let utc = new Date(`${date}T${time.slice(0, 5)}:00.000Z`);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = zonedParts(utc, timeZone);
    const dayShift = shown.date === date ? 0 : shown.date < date ? 1 : -1;
    const delta = dayShift * 1440 + (desired - shown.minutes);
    if (delta === 0) return utc.toISOString();
    utc = new Date(utc.getTime() + delta * 60000);
  }
  return utc.toISOString();
}

export function timeToMinutes(value: string): number {
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
}

export function arrivalStatus(clockIn: Date, settings: Pick<AttendanceSettings, 'timezone' | 'workStartTime' | 'gracePeriodMinutes'>): 'present' | 'late' {
  const arrival = zonedParts(clockIn, settings.timezone).minutes;
  const cutoff = timeToMinutes(settings.workStartTime) + settings.gracePeriodMinutes;
  return arrival > cutoff ? 'late' : 'present';
}

export function isPastWorkEnd(now: Date, settings: Pick<AttendanceSettings, 'timezone' | 'workEndTime'>, attendanceDate: string, today: string): boolean {
  if (attendanceDate < today) return true;
  if (attendanceDate > today) return false;
  return zonedParts(now, settings.timezone).minutes > timeToMinutes(settings.workEndTime);
}

export function displayStatus(
  record: { status: AttendanceStatus; clockInAt: string | null; clockOutAt: string | null; attendanceDate: string },
  settings: Pick<AttendanceSettings, 'timezone' | 'workEndTime'>,
  now: Date,
  today: string,
): AttendanceStatus {
  if (record.status === 'pending_review' || record.status === 'absent') return record.status;
  if (record.clockInAt && !record.clockOutAt && isPastWorkEnd(now, settings, record.attendanceDate, today)) {
    return 'incomplete';
  }
  return record.status;
}

export function isoWeekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  const mean = average(values);
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}
