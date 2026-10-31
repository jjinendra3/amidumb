import { describe, expect, it } from 'vitest';
import { withSpinner } from '../src/report/spinner';

const stream = (isTTY: boolean) => {
  const writes: string[] = [];
  return {
    writes,
    stream: {
      isTTY,
      columns: 80,
      write: (s: string) => writes.push(s),
    } as unknown as NodeJS.WriteStream,
  };
};

describe('withSpinner', () => {
  it('draws captions on a TTY and clears the line after', async () => {
    const s = stream(true);
    const value = await withSpinner(new Promise((r) => setTimeout(() => r(42), 60)), {
      captions: ['measuring vibes', 'judging silently'],
      stream: s.stream,
      frameMs: 10,
      captionMs: 20,
      random: () => 0,
    });
    const out = s.writes.join('');
    expect(value).toBe(42);
    expect(out).toContain('measuring vibes…');
    expect(out).toContain('judging silently…');
    expect(s.writes.at(-1)).toBe('\r\x1b[K\x1b[?25h');
  });

  it('writes nothing off a TTY and still returns the result', async () => {
    const s = stream(false);
    expect(await withSpinner(Promise.resolve('ok'), { captions: ['x'], stream: s.stream })).toBe(
      'ok',
    );
    expect(s.writes).toEqual([]);
  });

  it('restores the line when the task fails', async () => {
    const s = stream(true);
    await expect(
      withSpinner(Promise.reject(new Error('boom')), { captions: ['x'], stream: s.stream }),
    ).rejects.toThrow('boom');
    expect(s.writes.at(-1)).toBe('\r\x1b[K\x1b[?25h');
  });
});
