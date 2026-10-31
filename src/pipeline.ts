import type { WindowInfo } from './report/score';
import { type Leverage, readLeverage } from './signals/leverage';
import { computeSessionSignals, type SessionSignals } from './signals/session';
import { clipToWindow, readAllSessions, type Session, type SourceRoots } from './sources';

const DAY_MS = 86_400_000;
/** Score everything on disk by default. Claude Code itself deletes transcripts after 30
 * days unless `cleanupPeriodDays` is raised, so for many users that's about a month. */
const DEFAULT_DAYS = 'all';

export interface Loaded {
  /** Every session read, whatever its origin. */
  all: Session[];
  /** Interactive sessions, clipped to the window, with at least one prompt. */
  sessions: Session[];
  /** Signals for `sessions`, same order. */
  rows: SessionSignals[];
  leverage: Leverage;
  window: WindowInfo;
}

export async function load(roots: SourceRoots, days: number | 'all'): Promise<Loaded> {
  const since = days === 'all' ? undefined : Date.now() - days * DAY_MS;
  const all = await readAllSessions(roots, since);
  const sessions = all
    .filter((s) => s.origin === 'interactive')
    .map((s) => clipToWindow(s, since))
    .filter((s) => s.events.some((e) => e.kind === 'prompt'));
  const rows = sessions.map(computeSessionSignals);
  return {
    all,
    sessions,
    rows,
    leverage: readLeverage(sessions.flatMap((s) => (s.cwd ? [s.cwd] : []))),
    window: {
      days,
      sessions: rows.length,
      prompts: rows.reduce((n, r) => n + r.prompts, 0),
    },
  };
}

/** Reads the window to score: `--days` when given, all history otherwise. */
export function loadForScoring(roots: SourceRoots, days?: number | 'all'): Promise<Loaded> {
  return load(roots, days ?? DEFAULT_DAYS);
}
