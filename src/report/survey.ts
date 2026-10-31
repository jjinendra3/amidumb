import { homedir } from 'node:os';
import type { SourceRoots } from '../sources';
import { listJsonl } from '../sources/files';
import { isRecord, readJsonl, str } from '../sources/jsonl';

/**
 * Prints record kinds and the keys seen on each, with counts. Never prints values, so the
 * output is safe to share when a transcript format changes.
 */
export async function renderSurvey(roots: SourceRoots, since?: number): Promise<string> {
  const out: string[] = [];
  for (const [tool, root] of Object.entries(roots)) {
    const files = await listJsonl(root, since);
    const kinds = new Map<string, number>();
    const keys = new Map<string, Map<string, number>>();
    for (const file of files) {
      for await (const rec of readJsonl(file)) {
        const payload = isRecord(rec.payload) ? rec.payload : undefined;
        const item = payload && isRecord(payload.item) ? payload.item : undefined;
        const kind = [str(rec.type), str(payload?.type), str(item?.type)].filter(Boolean).join('/');
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        const seen = keys.get(kind) ?? new Map<string, number>();
        keys.set(kind, seen);
        const fields = [
          ...Object.keys(rec),
          ...Object.keys(payload ?? {}).map((k) => `payload.${k}`),
          ...Object.keys(item ?? {}).map((k) => `item.${k}`),
        ];
        for (const k of fields) seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    out.push(`== ${tool}: ${files.length} files under ${root.replace(homedir(), '~')}`);
    for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1])) {
      const fields = [...(keys.get(kind) ?? [])]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([k, c]) => (c === n ? k : `${k}(${c})`));
      out.push(`${String(n).padStart(8)}  ${kind}`, `          ${fields.join(', ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}
