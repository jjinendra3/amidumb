import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type JsonRecord = Record<string, unknown>;

/**
 * Streams JSON objects from a JSONL file. Lines that are blank, not valid JSON or not an
 * object are skipped, and a read error ends the stream quietly: transcript formats are
 * undocumented and a single bad line must not break a run.
 */
export async function* readJsonl(file: string): AsyncGenerator<JsonRecord> {
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) {
      if (!line) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (isRecord(value)) yield value;
    }
  } catch {
    // Unreadable file (deleted mid-run, permissions): treat as ended.
  } finally {
    lines.close();
    input.destroy();
  }
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function toMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}
