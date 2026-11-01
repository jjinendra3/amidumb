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

/**
 * One title per 5 points of the overall score, a ladder of who's in charge: at the bottom
 * the agent runs you, at the top you run it too hard. Every name is a roast, the top one
 * included, since a flattering title is the first thing people screenshot to dunk on the
 * tool. Names say how much you direct, never a specific habit, because only the score
 * picks them. Names are copy and can change freely; ids are stable.
 */
const BANDS: ReadonlyArray<[min: number, id: string, name: string]> = [
  [95, 'agents-worst-nightmare', "Agent's Worst Nightmare"],
  [90, 'trust-issues', 'Trust Issues'],
  [85, 'control-freak', 'Control Freak'],
  [80, 'micromanager', 'Micromanager'],
  [75, 'backseat-driver', 'Backseat Driver'],
  [70, 'hall-monitor', 'Hall Monitor'],
  [65, 'professional-delegator', 'Professional Delegator'],
  [60, 'middle-manager', 'Middle Manager'],
  [55, 'reluctant-manager', 'Reluctant Manager'],
  [50, 'part-time-boss', 'Part-Time Boss'],
  [45, 'ccd-on-everything', "Cc'd on Everything"],
  [40, 'mid-vibes', 'Mid Vibes'],
  [35, 'along-for-the-ride', 'Along for the Ride'],
  [30, 'vibe-tourist', 'Vibe Tourist'],
  [25, 'spectator', 'Spectator'],
  [20, 'passenger', 'Passenger'],
  [15, 'agents-assistant', "Agent's Assistant"],
  [10, 'interns-intern', "Intern's Intern"],
  [5, 'human-clipboard', 'Human Clipboard'],
  [0, 'hostage', 'Hostage'],
];

/** Ordered from the top: the first match wins. */
export const ARCHETYPES: readonly Archetype[] = BANDS.map(([min, id, name]) => ({
  id,
  name,
  when: (p: Profile) => p.overall >= min,
}));

export function pickArchetype(profile: Profile): Archetype {
  // The last entry always matches.
  return ARCHETYPES.find((a) => a.when(profile)) ?? (ARCHETYPES.at(-1) as Archetype);
}
