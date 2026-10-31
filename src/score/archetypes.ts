import type { TurnClass } from '../signals/turns';
import type { SubScoreId } from './rubric';

/** What archetype rules look at. Shares are of prompts, weighted like the sub-scores. */
export interface Profile {
  overall: number;
  sub: Partial<Record<SubScoreId, number>>;
  share: Record<TurnClass, number>;
  interruptsPer100: number;
}

export interface Archetype {
  id: string;
  name: string;
  when: (p: Profile) => boolean;
}

const sub = (p: Profile, id: SubScoreId) => p.sub[id] ?? 0;

/**
 * Ordered: the first match wins, so behaviour archetypes (how you work) come before
 * level archetypes (how well). Names are copy and can change freely; ids are stable.
 */
export const ARCHETYPES: readonly Archetype[] = [
  { id: 'error-paster', name: 'Error Paster', when: (p) => p.share.error_paste >= 0.15 },
  {
    id: 'slot-machine',
    name: 'Slot-Machine Vibecoder',
    when: (p) => p.share.retry + p.share.nudge >= 0.25 && sub(p, 'specification') < 45,
  },
  {
    id: 'backseat-driver',
    name: 'Backseat Driver',
    when: (p) => p.interruptsPer100 >= 25 || p.share.correct >= 0.25,
  },
  {
    id: 'staff-engineer',
    name: 'Staff Engineer',
    when: (p) => p.overall >= 80 && sub(p, 'verification') >= 70 && sub(p, 'steering') >= 60,
  },
  { id: 'architect', name: 'Architect', when: (p) => sub(p, 'specification') >= 75 },
  {
    id: 'rubber-stamper',
    name: 'Rubber Stamper',
    when: (p) => p.share.approve + p.share.nudge >= 0.3,
  },
  { id: 'director', name: 'Director', when: (p) => p.overall >= 60 },
  { id: 'mid-vibes', name: 'Mid Vibes', when: (p) => p.overall >= 40 },
  { id: 'passenger', name: 'Passenger', when: () => true },
];

export function pickArchetype(profile: Profile): Archetype {
  // The last entry always matches.
  return ARCHETYPES.find((a) => a.when(profile)) ?? (ARCHETYPES.at(-1) as Archetype);
}
