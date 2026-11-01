import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/signals/aggregate';
import { readLeverage } from '../src/signals/leverage';
import { computeSessionSignals } from '../src/signals/session';
import { clipToWindow } from '../src/sources';
import { stripInjected } from '../src/sources/context';
import { prompt, session, tempRoot } from './helpers';

describe('stripInjected', () => {
  it('removes IDE tags and the Codex IDE wrapper', () => {
    expect(stripInjected('<ide_selection>x</ide_selection>\nadd tests').text).toBe('add tests');
    expect(
      stripInjected(
        '# Context from my IDE setup:\n## Active file: a.ts\n## My request for Codex:\ngo',
      ).text,
    ).toBe('go');
  });

  it('keeps user-written sections and flags pastes', () => {
    const r = stripInjected('# Files pasted by the user:\nconst a = 1;\n## My request:\nwhy');
    expect(r).toEqual({ text: 'why', hasPaste: true, contextOnly: false });
    expect(stripInjected('# Response annotations:\nwrong\n## My request:\nredo').text).toBe(
      'wrong\nredo',
    );
  });

  it('reports context-only input', () => {
    expect(stripInjected('<ide_opened_file>a.ts</ide_opened_file>')).toEqual({
      text: '',
      hasPaste: false,
      contextOnly: true,
    });
  });

  it('leaves ordinary prompts untouched', () => {
    expect(stripInjected('# Plan\n1. do x').text).toBe('# Plan\n1. do x');
  });
});

describe('computeSessionSignals', () => {
  const s = session([
    { kind: 'mode', permission: 'auto', plan: false, ts: 0 },
    prompt('update src/cart.ts, only the reducer', { ts: 60_000 }),
    { kind: 'tool_call', name: 'Bash', command: 'pnpm test', ts: 120_000 },
    { kind: 'tool_call', name: 'Read' },
    prompt('fix it', { ts: 180_000 }),
    prompt('still not working', { ts: 4 * 3_600_000 }),
    { kind: 'interrupt', duringTool: false },
    { kind: 'tool_rejected', by: 'user' },
    { kind: 'tool_rejected', by: 'policy' },
    { kind: 'mode', permission: 'bypass', plan: false },
    prompt(`token = ${'x1'.repeat(10)}`),
    { kind: 'slash_command', name: 'plan' },
  ]);
  const r = computeSessionSignals(s);

  it('counts prompts, flags and events', () => {
    expect(r.prompts).toBe(4);
    expect(r.flags.pathOrSymbol).toBe(1);
    expect(r.flags.constraint).toBe(1);
    expect(r.flags.fixIt).toBe(2);
    expect(r.longestFixStreak).toBe(2);
    expect(r).toMatchObject({
      interrupts: 1,
      rejectedByUser: 1,
      rejectedByPolicy: 1,
      toolCalls: 2,
      shellCalls: 1,
      verifyCommands: 1,
      slashCommands: 1,
      planUsed: true,
    });
    expect(r.promptsByPermission).toEqual({ auto: 3, bypass: 1 });
  });

  it('caps idle gaps when counting active time', () => {
    // 1 + 1 + 1 minutes, then a ~4h gap capped at 15.
    expect(r.activeMinutes).toBe(18);
  });

  it('contains no prompt text or paths', () => {
    const json = JSON.stringify(
      computeSessionSignals({ ...s, cwd: '/Users/dev/secret-repo', title: 'Secret' }),
    );
    expect(json).not.toMatch(/cart|reducer|secret-repo|Secret|\/Users/);
    expect(r.id).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('aggregate', () => {
  it('weights sessions equally', () => {
    const long = session(
      Array.from({ length: 99 }, () => prompt('fix it')),
      { id: 'long' },
    );
    const short = session([prompt('add a test for parseOrder')], { id: 'short' });
    const a = aggregate([computeSessionSignals(long), computeSessionSignals(short)]);
    expect(a.flagRates.fixIt).toBeCloseTo(0.5);
    expect(a.prompts).toBe(100);
  });
});

describe('clipToWindow', () => {
  it('drops events before the window and keeps undated ones', () => {
    const s = session([prompt('old', { ts: 1 }), prompt('new', { ts: 10 }), prompt('undated')]);
    const clipped = clipToWindow(s, 5);
    expect(clipped.events.map((e) => (e.kind === 'prompt' ? e.text : ''))).toEqual([
      'new',
      'undated',
    ]);
    expect(clipped.startedAt).toBe(10);
  });
});

describe('readLeverage', () => {
  it('counts Codex skills, prompts and hooks, but not its built-in skills', () => {
    const codex = tempRoot();
    for (const dir of ['skills/review', 'skills/deploy', 'skills/.system', 'prompts']) {
      mkdirSync(join(codex, dir), { recursive: true });
    }
    writeFileSync(join(codex, 'prompts', 'plan.md'), '');
    writeFileSync(join(codex, 'hooks.json'), JSON.stringify({ hooks: { Stop: [] } }));
    const l = readLeverage([], { CODEX_HOME: codex, CLAUDE_CONFIG_DIR: tempRoot() });
    expect(l).toMatchObject({
      codexSkills: 2,
      codexPrompts: 1,
      codexHooks: true,
      claudeHooks: false,
    });
  });

  it('finds Codex hooks declared in config.toml', () => {
    const codex = tempRoot();
    writeFileSync(
      join(codex, 'config.toml'),
      'model = "x"\n\n[[hooks.Stop]]\ncommand = "say done"\n',
    );
    expect(readLeverage([], { CODEX_HOME: codex, CLAUDE_CONFIG_DIR: tempRoot() }).codexHooks).toBe(
      true,
    );
    writeFileSync(join(codex, 'config.toml'), 'model = "x"\n');
    expect(readLeverage([], { CODEX_HOME: codex, CLAUDE_CONFIG_DIR: tempRoot() }).codexHooks).toBe(
      false,
    );
  });
});
