import type { ChallengeInstruction } from '../shared/types';

export function descriptor(seed: number): number[] {
  return Array.from({ length: 128 }, (_, index) => (index === seed ? 1 : 0));
}

export function motion(instruction: string) {
  const kind = instruction as ChallengeInstruction;
  return Array.from({ length: 10 }, (_, index) => ({
    noseX: kind === 'turn_left' ? 0.62 - index * 0.014 : kind === 'turn_right' ? 0.38 + index * 0.014 : 0.5,
    noseY: kind === 'nod' ? 0.42 + index * 0.012 : 0.5 + index * 0.002,
    eyeDX: 0.2,
    t: index * 120,
  }));
}
