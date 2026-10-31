import { homedir } from 'node:os';
import { join } from 'node:path';
import { readClaudeSessions } from './claude';
import { readCodexSessions } from './codex';
import type { AgentTool, Session } from './types';

export { readClaudeSessions } from './claude';
export { readCodexSessions } from './codex';
export type * from './types';

export type SourceRoots = Record<AgentTool, string>;

/** Default transcript roots, honouring each tool's config-dir override. */
export function defaultRoots(env: NodeJS.ProcessEnv = process.env): SourceRoots {
  return {
    'claude-code': join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects'),
    codex: join(env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'),
  };
}

export async function readAllSessions(roots: SourceRoots, since?: number): Promise<Session[]> {
  const [claude, codex] = await Promise.all([
    readClaudeSessions({ root: roots['claude-code'], since }),
    readCodexSessions({ root: roots.codex, since }),
  ]);
  return [...claude, ...codex];
}

/**
 * Drops events before `since` (events without a timestamp are kept) and recomputes the
 * session's time span. Sessions resumed into the window keep only their in-window part.
 */
export function clipToWindow(session: Session, since?: number): Session {
  if (since === undefined) return session;
  const events = session.events.filter((e) => e.ts === undefined || e.ts >= since);
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  for (const { ts } of events) {
    if (ts === undefined) continue;
    if (startedAt === undefined || ts < startedAt) startedAt = ts;
    if (endedAt === undefined || ts > endedAt) endedAt = ts;
  }
  return {
    ...session,
    events,
    startedAt: startedAt ?? session.startedAt,
    endedAt: endedAt ?? session.endedAt,
  };
}
