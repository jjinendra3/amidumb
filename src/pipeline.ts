import type { WindowInfo } from './report/score';
import { hasEnoughData } from './score/rubric';
import { type Leverage, readLeverage } from './signals/leverage';
import { computeSessionSignals, type SessionSignals } from './signals/session';
import { clipToWindow, readAllSessions, type Session, type SourceRoots } from './sources';

const DAY_MS = 86_400_000;
/** Default window, widened in this order until there's enough data to score. */
const WIDENING: readonly (number | 'all')[] = [30, 90, 'all'];

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

export async function load(
  roots: SourceRoots,
  days: number | 'all',
  widened = false,
): Promise<Loaded> {
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
      widened,
      sessions: rows.length,
      prompts: rows.reduce((n, r) => n + r.prompts, 0),
    },
  };
}

/**
 * Reads the window to score. An explicit `days` is respected as is; otherwise the window
 * widens from 30 days to 90 to all history until there is enough data.
 */
export async function loadForScoring(roots: SourceRoots, days?: number | 'all'): Promise<Loaded> {
  if (days !== undefined) return load(roots, days);
  let loaded: Loaded | undefined;
  for (const [i, d] of WIDENING.entries()) {
    loaded = await load(roots, d, i > 0);
    if (hasEnoughData(loaded.rows)) break;
  }
  return loaded as Loaded;
}
