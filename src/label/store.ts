import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isValidLabel, type SessionLabel } from './fields';

export interface LabelStore {
  schema: 1;
  /** Keyed by the hashed session id used in SessionSignals.id. */
  labels: Record<string, SessionLabel>;
}

export function labelsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.AMIDUMB_HOME ?? join(homedir(), '.amidumb'), 'labels.json');
}

/** Missing, unreadable or corrupt files load as an empty store; invalid entries are dropped. */
export function loadLabels(path: string): LabelStore {
  const store: LabelStore = { schema: 1, labels: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return store;
  }
  const labels = (parsed as { labels?: unknown } | null)?.labels;
  if (typeof labels !== 'object' || labels === null) return store;
  for (const [id, label] of Object.entries(labels)) {
    if (isValidLabel(label)) store.labels[id] = label;
  }
  return store;
}

/** Writes atomically, so quitting mid-write can't corrupt earlier labels. */
export function saveLabels(path: string, store: LabelStore): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(tmp, path);
}
