import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Session, SessionEvent } from '../src/sources';

export function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'amidumb-test-'));
}

/** Writes records as JSONL. Strings are written verbatim, to simulate corrupt lines. */
export function writeJsonl(root: string, path: string, records: unknown[]): string {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`,
  );
  return file;
}

export function ofKind<K extends SessionEvent['kind']>(
  session: Session | undefined,
  kind: K,
): Extract<SessionEvent, { kind: K }>[] {
  return (session?.events ?? []).filter(
    (e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind,
  );
}

export function prompt(text: string, extra: Partial<SessionEvent> = {}): SessionEvent {
  return {
    kind: 'prompt',
    text,
    rawLength: text.length,
    hasPaste: false,
    images: 0,
    ...extra,
  } as SessionEvent;
}

export function session(events: SessionEvent[], extra: Partial<Session> = {}): Session {
  return { tool: 'claude-code', id: 's1', origin: 'interactive', client: 'cli', events, ...extra };
}
