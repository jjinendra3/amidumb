import type { Leverage } from '../signals/leverage';
import type { SessionSignals } from '../signals/session';
import { TURN_CLASSES, type TurnClass } from '../signals/turns';
import { type Archetype, type Profile, pickArchetype } from './archetypes';

// The score is a fixed, versioned rubric over local signals: no LLM, no fitted weights.
// Bump RUBRIC_VERSION whenever a threshold or weight changes, so old and new scores are
// never compared as if they meant the same thing.

export const RUBRIC_VERSION = 2;

export const SUB_SCORES = [
  'specification',
  'steering',
  'verification',
  'discipline',
  'leverage',
] as const;
export type SubScoreId = (typeof SUB_SCORES)[number];

export const SUB_SCORE_WEIGHTS: Record<SubScoreId, number> = {
  specification: 0.3,
  steering: 0.2,
  verification: 0.2,
  discipline: 0.2,
  leverage: 0.1,
};

/** Score of each opening class, out of 100. Question openings are exploration: skipped. */
const OPENING_SCORE: Record<TurnClass, number | undefined> = {
  specify: 100,
  instruct: 40,
  correct: 50,
  verify: 50,
  approve: 30,
  nudge: 30,
  retry: 30,
  error_paste: 0,
  question: undefined,
};
/** A specify opening with one marker is a clear goal; it takes 2+ to be a full spec. */
const ONE_MARKER_OPENING = 70;

function openingScore(r: SessionSignals): number | undefined {
  if (!r.opening) return undefined;
  if (r.opening === 'specify' && r.openingMarkers < 2) return ONE_MARKER_OPENING;
  return OPENING_SCORE[r.opening];
}

/** Enough data to score: this many sessions with 2+ prompts, and this many prompts. */
export const MIN_SESSIONS = 5;
export const MIN_PROMPTS = 30;

/** Maps x linearly onto 0..100 between `zeroAt` and `fullAt` (either order), clamped. */
export function ramp(x: number, zeroAt: number, fullAt: number): number {
  const t = (x - zeroAt) / (fullAt - zeroAt);
  return 100 * Math.min(1, Math.max(0, t));
}

interface Component {
  value: number | undefined;
  weight: number;
}

/** Weighted mean of the defined components; undefined when none is defined. */
export function combine(components: readonly Component[]): number | undefined {
  let total = 0;
  let weights = 0;
  for (const { value, weight } of components) {
    if (value === undefined) continue;
    total += value * weight;
    weights += weight;
  }
  return weights > 0 ? total / weights : undefined;
}

export type SessionScore = {
  id: string;
  prompts: number;
  overall: number | undefined;
  /** The opening-prompt part of Specification, exposed for calibration. */
  opening: number | undefined;
} & Partial<Record<Exclude<SubScoreId, 'leverage'>, number>>;

export function scoreSession(r: SessionSignals): SessionScore {
  const t = r.turns;
  const share = (n: number) => (r.prompts ? n / r.prompts : 0);

  const instructions = t.specify + t.instruct;
  const opening = openingScore(r);
  const specification = combine([
    {
      value: instructions ? ramp(t.specify / instructions, 0.1, 0.6) : undefined,
      weight: 0.6,
    },
    { value: opening, weight: 0.4 },
  ]);

  const good = t.approve + t.correct + r.interrupts;
  const bad = t.retry + 0.5 * Math.max(0, r.longestNudgeRun - 2);
  const steering = good + bad > 0 ? ramp(good / (good + bad), 0.3, 0.85) : undefined;

  // You checked (asked for tests or a review, or reported what you saw running it): 100.
  // Only the agent checked: 60. Nobody did: 0. No code changed: not applicable.
  const humanChecked = t.verify > 0 || r.observed > 0;
  const verification =
    r.editCalls > 0 ? (humanChecked ? 100 : r.verifyCommands > 0 ? 60 : 0) : undefined;

  const discipline = clamp(
    100 -
      150 * share(t.retry) -
      150 * share(t.error_paste) -
      10 * Math.max(0, r.longestNudgeRun - 2) -
      20 * share(r.promptsByPermission.bypass ?? 0) -
      50 * share(r.flags.rage),
  );

  const overall = combine([
    { value: specification, weight: SUB_SCORE_WEIGHTS.specification },
    { value: steering, weight: SUB_SCORE_WEIGHTS.steering },
    { value: verification, weight: SUB_SCORE_WEIGHTS.verification },
    { value: discipline, weight: SUB_SCORE_WEIGHTS.discipline },
  ]);

  return {
    id: r.id,
    prompts: r.prompts,
    opening,
    specification,
    steering,
    verification,
    discipline,
    overall,
  };
}

export function scoreLeverage(l: Leverage): number {
  const projectShare = l.projectsChecked ? l.projectsWithInstructions / l.projectsChecked : 0;
  return Math.round(
    (l.claudeGlobalInstructions || l.codexGlobalInstructions ? 35 : 0) +
      (35 * ramp(projectShare, 0, 0.6)) / 100 +
      (l.claudeSkills + l.claudeCommands >= 3 ? 15 : 0) +
      (l.claudeHooks ? 15 : 0),
  );
}

export function hasEnoughData(rows: readonly SessionSignals[]): boolean {
  const sessions = rows.filter((r) => r.prompts >= 2).length;
  const prompts = rows.reduce((n, r) => n + r.prompts, 0);
  return sessions >= MIN_SESSIONS && prompts >= MIN_PROMPTS;
}

export interface SubScore {
  score: number;
  /** Numbers only, safe for --json. */
  reason: string;
}

export interface UserScore {
  rubricVersion: number;
  overall: number;
  subScores: Partial<Record<SubScoreId, SubScore>>;
  archetype: Pick<Archetype, 'id' | 'name'>;
  profile: Profile;
}

/** Undefined when there isn't enough data to score. */
export function scoreUser(
  rows: readonly SessionSignals[],
  leverage: Leverage,
): UserScore | undefined {
  if (!hasEnoughData(rows)) return undefined;
  const scored = rows.filter((r) => r.prompts > 0).map((r) => [r, scoreSession(r)] as const);
  // Each session counts by its prompts, capped: one-prompt sessions count less and no
  // single marathon session decides the score.
  const weight = (r: SessionSignals) => Math.min(r.prompts, 10);
  const mean = (f: (s: SessionScore) => number | undefined) =>
    combine(scored.map(([r, s]) => ({ value: f(s), weight: weight(r) })));

  const totals = sumTurns(rows);
  const pooled = (n: number, d: number) => (d ? n / d : 0);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const editSessions = rows.filter((r) => r.editCalls > 0);
  const openings = rows.filter((r) => r.opening && r.opening !== 'question');

  const values: Record<SubScoreId, [number | undefined, string]> = {
    specification: [
      mean((s) => s.specification),
      `${pct(pooled(totals.specify, totals.specify + totals.instruct))} of your instructions name a file, symbol, constraint or done-criteria; ` +
        `${pct(pooled(openings.filter((r) => r.opening === 'specify').length, openings.length))} of sessions open with one`,
    ],
    steering: [
      mean((s) => s.steering),
      `${totals.approve} approvals after a proposal, ${totals.correct} corrections and ` +
        `${rows.reduce((n, r) => n + r.interrupts, 0)} interrupts, against ${totals.retry} bare retries`,
    ],
    verification: [
      mean((s) => s.verification),
      `you asked for tests or a review, or reported what you saw, in ${pct(pooled(editSessions.filter((r) => r.turns.verify > 0 || r.observed > 0).length, editSessions.length))} of sessions that changed code; ` +
        `the agent ran checks in ${pct(pooled(editSessions.filter((r) => r.verifyCommands > 0).length, editSessions.length))}`,
    ],
    discipline: [
      mean((s) => s.discipline),
      `${pct(
        pooled(
          totals.retry + totals.error_paste,
          rows.reduce((n, r) => n + r.prompts, 0),
        ),
      )} of prompts were bare retries or pasted errors; ` +
        `longest run of bare "continue": ${rows.reduce((m, r) => Math.max(m, r.longestNudgeRun), 0)}`,
    ],
    leverage: [
      scoreLeverage(leverage),
      `${leverage.claudeGlobalInstructions || leverage.codexGlobalInstructions ? 'global instructions' : 'no global instructions'}, ` +
        `${leverage.projectsWithInstructions}/${leverage.projectsChecked} projects with CLAUDE.md/AGENTS.md, ` +
        `${leverage.claudeSkills} skills, ${leverage.claudeHooks ? 'hooks' : 'no hooks'}`,
    ],
  };

  const subScores: Partial<Record<SubScoreId, SubScore>> = {};
  for (const id of SUB_SCORES) {
    const [score, reason] = values[id];
    if (score !== undefined) subScores[id] = { score: Math.round(score), reason };
  }
  const overall = Math.round(
    combine(
      SUB_SCORES.map((id) => ({ value: subScores[id]?.score, weight: SUB_SCORE_WEIGHTS[id] })),
    ) ?? 0,
  );

  const share = Object.fromEntries(
    TURN_CLASSES.map((c) => [
      c,
      combine(scored.map(([r]) => ({ value: r.turns[c] / r.prompts, weight: weight(r) }))) ?? 0,
    ]),
  ) as Record<TurnClass, number>;
  const profile: Profile = {
    overall,
    sub: Object.fromEntries(
      SUB_SCORES.flatMap((id) => (subScores[id] ? [[id, subScores[id].score]] : [])),
    ),
    share,
    interruptsPer100:
      100 *
      (combine(scored.map(([r]) => ({ value: r.interrupts / r.prompts, weight: weight(r) }))) ?? 0),
  };
  const { id, name } = pickArchetype(profile);

  return { rubricVersion: RUBRIC_VERSION, overall, subScores, archetype: { id, name }, profile };
}

function sumTurns(rows: readonly SessionSignals[]): Record<TurnClass, number> {
  const out = Object.fromEntries(TURN_CLASSES.map((c) => [c, 0])) as Record<TurnClass, number>;
  for (const r of rows) for (const c of TURN_CLASSES) out[c] += r.turns[c];
  return out;
}

function clamp(x: number): number {
  return Math.min(100, Math.max(0, x));
}
