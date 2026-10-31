import type { PermissionLevel } from '../sources';
import { PROMPT_FLAGS, type PromptFlag, quantile, type SessionSignals } from './session';

export interface AggregateSignals {
  sessions: number;
  prompts: number;
  promptsPerSession: number;
  promptCharsMedian: number;
  promptCharsP90: number;
  activeHours: number;
  /** Share of prompts per classifier, averaged over sessions so one long session can't dominate. */
  flagRates: Record<PromptFlag, number>;
  pastedRate: number;
  interruptsPer100Prompts: number;
  rejectionsPer100Prompts: number;
  planSessionsRate: number;
  verifySessionsRate: number;
  /** Pooled over prompts. */
  permissionShare: Partial<Record<PermissionLevel, number>>;
  longestFixStreak: number;
  slashCommands: number;
  compactions: number;
  toolErrors: number;
  images: number;
  secrets: number;
}

export function aggregate(rows: readonly SessionSignals[]): AggregateSignals {
  const withPrompts = rows.filter((r) => r.prompts > 0);
  const perSession = (f: (r: SessionSignals) => number) => mean(withPrompts.map(f));
  const sum = (f: (r: SessionSignals) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  const prompts = sum((r) => r.prompts);

  const flagRates = Object.fromEntries(
    (Object.keys(PROMPT_FLAGS) as PromptFlag[]).map((k) => [
      k,
      perSession((r) => r.flags[k] / r.prompts),
    ]),
  ) as Record<PromptFlag, number>;

  const permissionCounts: Partial<Record<PermissionLevel, number>> = {};
  for (const r of rows) {
    for (const [mode, n] of Object.entries(r.promptsByPermission) as [PermissionLevel, number][]) {
      permissionCounts[mode] = (permissionCounts[mode] ?? 0) + n;
    }
  }
  const permissionShare = Object.fromEntries(
    Object.entries(permissionCounts).map(([mode, n]) => [mode, prompts ? n / prompts : 0]),
  ) as Partial<Record<PermissionLevel, number>>;

  return {
    sessions: rows.length,
    prompts,
    promptsPerSession: quantile(
      withPrompts.map((r) => r.prompts),
      0.5,
    ),
    // Median of per-session medians; pooling would let one chatty session decide it.
    promptCharsMedian: quantile(
      withPrompts.map((r) => r.promptChars.median),
      0.5,
    ),
    promptCharsP90: quantile(
      withPrompts.map((r) => r.promptChars.p90),
      0.5,
    ),
    activeHours: Math.round(sum((r) => r.activeMinutes) / 6) / 10,
    flagRates,
    pastedRate: perSession((r) => r.pasted / r.prompts),
    interruptsPer100Prompts: 100 * perSession((r) => r.interrupts / r.prompts),
    rejectionsPer100Prompts: 100 * perSession((r) => r.rejectedByUser / r.prompts),
    planSessionsRate: perSession((r) => (r.planUsed ? 1 : 0)),
    verifySessionsRate: perSession((r) => (r.verifyCommands > 0 ? 1 : 0)),
    permissionShare,
    longestFixStreak: rows.reduce((m, r) => Math.max(m, r.longestFixStreak), 0),
    slashCommands: sum((r) => r.slashCommands),
    compactions: sum((r) => r.compactions),
    toolErrors: sum((r) => r.toolErrors),
    images: sum((r) => r.images),
    secrets: sum((r) => r.secrets),
  };
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
