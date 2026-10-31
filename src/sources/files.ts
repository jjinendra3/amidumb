import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Recursively lists `.jsonl` files under `root`, skipping files last modified before
 * `since`. Returns an empty list when `root` doesn't exist.
 */
export async function listJsonl(root: string, since?: number): Promise<string[]> {
  const out: string[] = [];
  await walk(root, since, out);
  return out.sort();
}

async function walk(dir: string, since: number | undefined, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, since, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      if (since !== undefined) {
        try {
          if ((await stat(path)).mtimeMs < since) continue;
        } catch {
          continue;
        }
      }
      out.push(path);
    }
  }
}
