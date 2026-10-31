import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { roast } from '../src/judge/flow';
import { maskForCard } from '../src/judge/mask';
import { buildJudgePrompt, type JudgeContext } from '../src/judge/prompt';
import { detectJudge, type Exec, parseJsonText, runJudge } from '../src/judge/run';
import { buildSample, MAX_CHARS, MAX_ITEMS, type Sample } from '../src/judge/sample';
import { JudgeError, resolveJudgeOutput } from '../src/judge/schema';
import { scoreUser } from '../src/score/rubric';
import type { Session, SessionEvent } from '../src/sources';
import { prompt, tempRoot } from './helpers';
import { PERSONAS, rowsOf } from './personas';

const TOKEN = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
const agent = (text: string): SessionEvent => ({ kind: 'assistant_text', text });

function sessionsOf(count: number, build: (i: number) => SessionEvent[]): Session[] {
  return Array.from({ length: count }, (_, i) => ({
    tool: 'claude-code',
    id: `s${i}`,
    origin: 'interactive',
    client: 'cli',
    startedAt: Date.parse('2026-10-01') + i * 86_400_000,
    events: build(i),
  }));
}

const mixed = sessionsOf(40, (i) => [
  prompt(
    `Add a retry to fetchUser in src/api/user.ts, only on 5xx, session ${i}. ${'x'.repeat(400)}`,
  ),
  agent(`Plan: wrap the call. Should I proceed? ${'y'.repeat(400)}`),
  prompt('yes'),
  agent('Done.'),
  prompt('fix it'),
  agent('Fixed.'),
  prompt('continue'),
  agent('Done.'),
  prompt("TypeError: Cannot read properties of undefined (reading 'id')"),
  agent('Patched.'),
  prompt(`no, use the cache instead, token ${TOKEN}`),
  agent('Switched.'),
  prompt('WHY IS THIS STILL BROKEN'),
]);

const persona = PERSONAS.mixed;
const userScore = scoreUser(rowsOf(persona), persona.leverage);
if (!userScore) throw new Error('persona must score');
const context: JudgeContext = {
  score: userScore,
  window: { days: 30, widened: false, sessions: 6, prompts: 48 },
  ragePrompts: 2,
  secrets: 1,
};

describe('buildSample', () => {
  const sample = buildSample(mixed);

  it('stays within the item and character budget', () => {
    expect(sample.items.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(sample.chars).toBeLessThanOrEqual(MAX_CHARS);
    expect(sample.items.length).toBeGreaterThan(100);
  });

  it('covers every kind of turn, so receipts can go either way', () => {
    const classes = new Set(sample.items.map((i) => i.cls));
    for (const cls of ['specify', 'approve', 'retry', 'nudge', 'error_paste', 'correct']) {
      expect(classes).toContain(cls);
    }
    expect(sample.items.some((i) => i.opening)).toBe(true);
  });

  it('redacts secrets and cuts long text', () => {
    const all = JSON.stringify(sample);
    expect(all).not.toContain('A1b2C3d4E5');
    expect(all).toContain('[REDACTED:github-token]');
    expect(sample.redacted).toBeGreaterThan(0);
    expect(Math.max(...sample.items.map((i) => i.prompt.length))).toBeLessThanOrEqual(500);
    expect(Math.max(...sample.items.map((i) => i.before?.length ?? 0))).toBeLessThanOrEqual(300);
  });

  it('pairs each prompt with the agent message before it', () => {
    const yes = sample.items.find((i) => i.prompt === 'yes');
    expect(yes?.before).toMatch(/^Plan: wrap the call/);
    expect(yes?.cls).toBe('approve');
    expect(sample.items.filter((i) => i.opening).every((i) => i.before === undefined)).toBe(true);
  });

  it('is deterministic and numbered in order', () => {
    expect(buildSample(mixed)).toEqual(sample);
    expect(sample.items.map((i) => i.id)).toEqual(sample.items.map((_, n) => `p${n + 1}`));
  });
});

const smallSample: Sample = buildSample(
  sessionsOf(3, () => [prompt('add a logout button to src/Header.tsx'), prompt('fix it')]),
);

describe('resolveJudgeOutput', () => {
  const good = {
    verdict: 'You steer well and verify rarely.',
    roast: ['One', 'Two', 'Three', 'Four'],
    receipts: [
      { id: 'p1', why: 'a real spec' },
      { id: '[p2]', why: 'a bare retry' },
      { id: 'p1', why: 'duplicate' },
    ],
    habits: ['a', 'b', 'c'],
  };

  it('quotes receipts from the local sample by id', () => {
    const v = resolveJudgeOutput(good, smallSample);
    expect(v.receipts.map((r) => r.item.prompt)).toEqual([
      smallSample.items[0]?.prompt,
      smallSample.items[1]?.prompt,
    ]);
    expect(v.roast).toHaveLength(3);
  });

  it('rejects made-up receipt ids', () => {
    const fake = {
      ...good,
      receipts: [
        { id: 'p1', why: 'x' },
        { id: 'p999', why: 'invented' },
      ],
    };
    expect(() => resolveJudgeOutput(fake, smallSample)).toThrow(/p999/);
  });

  it('rejects malformed output', () => {
    expect(() => resolveJudgeOutput({ verdict: 'x' }, smallSample)).toThrow(JudgeError);
    expect(() => resolveJudgeOutput('nope', smallSample)).toThrow(JudgeError);
  });

  it('cuts over-long text instead of failing', () => {
    const v = resolveJudgeOutput({ ...good, verdict: 'v'.repeat(500) }, smallSample);
    expect(v.verdict.length).toBe(200);
  });
});

describe('maskForCard', () => {
  it.each([
    ['fix src/cart/Total.tsx please', 'fix ‹file› please'],
    ['see https://example.com/x?y=1 now', 'see ‹url› now'],
    ['rename useCartStore and max_retries', 'rename ‹code› and ‹code›'],
    ['the `computeTotal` bug in OrderCard', 'the ‹code› bug in ‹code›'],
    ['check config.yaml and refresh()', 'check ‹file› and ‹code›'],
  ])('%j → %j', (input, output) => expect(maskForCard(input)).toBe(output));

  it('leaves ordinary words and product names alone', () => {
    const text = 'make the button blue, push to GitHub and keep the layout on iPhone';
    expect(maskForCard(text)).toBe(text);
  });
});

describe('runJudge', () => {
  const exec = (impl: (args: readonly string[]) => Partial<Awaited<ReturnType<Exec>>>): Exec =>
    vi.fn(async (_cmd, args) => ({
      code: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      ...impl(args),
    }));

  it('reads structured output from claude', async () => {
    const run = exec(() => ({
      stdout: JSON.stringify({ is_error: false, structured_output: { a: 1 } }),
    }));
    expect(await runJudge('claude', 'PROMPT', run)).toEqual({ a: 1 });
    const [cmd, args, opts] = vi.mocked(run).mock.calls[0] ?? [];
    expect(cmd).toBe('claude');
    expect(args).toEqual(expect.arrayContaining(['--no-session-persistence', '--safe-mode']));
    expect(opts?.input).toBe('PROMPT');
  });

  it('surfaces claude errors', async () => {
    const run = exec(() => ({
      stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns' }),
    }));
    await expect(runJudge('claude', 'x', run)).rejects.toThrow(/error_max_turns/);
    await expect(
      runJudge(
        'claude',
        'x',
        exec(() => ({ timedOut: true })),
      ),
    ).rejects.toThrow(/longer/);
  });

  it('reads the last message file from codex', async () => {
    const run = exec((args) => {
      const out = args[args.indexOf('--output-last-message') + 1] as string;
      writeFileSync(out, 'Here you go:\n```json\n{"b":2}\n```');
      return {};
    });
    expect(await runJudge('codex', 'x', run)).toEqual({ b: 2 });
    const [, args] = vi.mocked(run).mock.calls[0] ?? [];
    expect(args).toEqual(expect.arrayContaining(['exec', '--ephemeral', '-']));
  });

  it('reports a failed codex run', async () => {
    const run = exec(() => ({ code: 1, stderr: 'not logged in' }));
    await expect(runJudge('codex', 'x', run)).rejects.toThrow(/not logged in/);
  });

  it('parses JSON wrapped in prose and rejects non-JSON', () => {
    expect(parseJsonText('ok {"a":1} done', 'x')).toEqual({ a: 1 });
    expect(() => parseJsonText('no json here', 'x')).toThrow(JudgeError);
  });
});

describe('detectJudge', () => {
  it('prefers claude and falls back to codex', () => {
    const dir = tempRoot();
    const fake = (name: string) => {
      writeFileSync(join(dir, name), '#!/bin/sh\n');
      chmodSync(join(dir, name), 0o755);
    };
    expect(detectJudge({ PATH: dir })).toBeUndefined();
    fake('codex');
    expect(detectJudge({ PATH: dir })).toBe('codex');
    fake('claude');
    expect(detectJudge({ PATH: dir })).toBe('claude');
  });
});

describe('roast flow', () => {
  const sample = buildSample(mixed);
  const base = {
    sample,
    context,
    yes: false,
    interactive: true,
    judge: 'claude' as const,
    print: vi.fn(),
    info: vi.fn(),
  };

  it('--dry-run prints the prompt and sends nothing', async () => {
    const exec = vi.fn();
    const print = vi.fn();
    const result = await roast({ ...base, dryRun: true, confirm: vi.fn(), exec, print });
    expect(result.status).toBe('dry-run');
    expect(exec).not.toHaveBeenCalled();
    expect(print.mock.calls[0]?.[0]).toBe(buildJudgePrompt(context, sample));
  });

  it('asks first and sends nothing on no', async () => {
    const exec = vi.fn();
    const confirm = vi.fn(async () => false);
    const result = await roast({ ...base, dryRun: false, confirm, exec });
    expect(confirm).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: 'skipped', reason: 'you said no' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('never sends from a non-interactive run without --yes', async () => {
    const exec = vi.fn();
    const result = await roast({
      ...base,
      dryRun: false,
      interactive: false,
      confirm: vi.fn(),
      exec,
    });
    expect(result.status).toBe('skipped');
    expect(exec).not.toHaveBeenCalled();
  });

  it('judges and resolves receipts with --yes', async () => {
    const exec: Exec = async () => ({
      code: 0,
      stderr: '',
      timedOut: false,
      stdout: JSON.stringify({
        structured_output: {
          verdict: 'v',
          roast: ['r'],
          receipts: [
            { id: 'p1', why: 'w' },
            { id: 'p2', why: 'w' },
          ],
          habits: ['h'],
        },
      }),
    });
    const result = await roast({ ...base, dryRun: false, yes: true, confirm: vi.fn(), exec });
    expect(result.status === 'done' && result.verdict.receipts[0]?.item.id).toBe('p1');
  });
});

describe('judge prompt', () => {
  const text = buildJudgePrompt(context, buildSample(mixed));

  it('carries the fixed score and the redacted sample, and no tool output', () => {
    expect(text).toContain(`direction score: ${context.score.overall}/100`);
    expect(text).toContain(`archetype: ${context.score.archetype.name}`);
    expect(text).toContain('[p1]');
    expect(text).not.toContain('A1b2C3d4E5');
    expect(text.length / 4).toBeLessThan(32_000);
  });
});
