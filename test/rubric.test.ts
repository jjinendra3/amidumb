import { describe, expect, it } from 'vitest';
import { pickArchetype } from '../src/score/archetypes';
import { combine, hasEnoughData, ramp, scoreSession, scoreUser } from '../src/score/rubric';
import type { Leverage } from '../src/signals/leverage';
import { computeSessionSignals } from '../src/signals/session';
import { TURN_CLASSES } from '../src/signals/turns';
import { prompt, session } from './helpers';

const leverage: Leverage = {
  claudeGlobalInstructions: false,
  codexGlobalInstructions: false,
  claudeSkills: 0,
  claudeCommands: 0,
  claudeHooks: false,
  projectsWithInstructions: 0,
  projectsChecked: 0,
  projectsMissing: 0,
};

describe('ramp', () => {
  it('maps and clamps in both directions', () => {
    expect(ramp(0.35, 0.1, 0.6)).toBeCloseTo(50);
    expect(ramp(0, 0.1, 0.6)).toBe(0);
    expect(ramp(1, 0.1, 0.6)).toBe(100);
    expect(ramp(0.25, 0.5, 0)).toBeCloseTo(50);
  });
});

describe('combine', () => {
  it('skips undefined components and rescales the rest', () => {
    expect(
      combine([
        { value: 80, weight: 0.6 },
        { value: undefined, weight: 0.4 },
      ]),
    ).toBe(80);
    expect(
      combine([
        { value: 100, weight: 3 },
        { value: 0, weight: 1 },
      ]),
    ).toBe(75);
    expect(combine([{ value: undefined, weight: 1 }])).toBeUndefined();
  });
});

describe('scoreSession', () => {
  it('leaves Verification undefined when nothing was edited', () => {
    const r = computeSessionSignals(session([prompt('explain how the auth flow works')]));
    expect(scoreSession(r).verification).toBeUndefined();
  });

  it('gives full Verification for asking, 60 when only the agent checked', () => {
    const asked = session([
      prompt('add a retry to src/api.ts'),
      { kind: 'tool_call', name: 'Edit' },
      prompt('run the tests'),
    ]);
    const agentOnly = session([
      prompt('add a retry to src/api.ts'),
      { kind: 'tool_call', name: 'Edit' },
      { kind: 'tool_call', name: 'Bash', command: 'pnpm test' },
    ]);
    expect(scoreSession(computeSessionSignals(asked)).verification).toBe(100);
    expect(scoreSession(computeSessionSignals(agentOnly)).verification).toBe(60);
  });

  it('leaves Steering undefined with nothing to steer', () => {
    const r = computeSessionSignals(session([prompt('add a retry to src/api.ts')]));
    expect(scoreSession(r).steering).toBeUndefined();
  });
});

describe('scoreUser', () => {
  const many = (n: number, prompts: string[]) =>
    Array.from({ length: n }, (_, i) =>
      computeSessionSignals(
        session(
          prompts.map((p) => prompt(p)),
          { id: `s${i}` },
        ),
      ),
    );

  it('needs enough sessions and prompts', () => {
    expect(hasEnoughData(many(4, Array(10).fill('add x')))).toBe(false);
    expect(hasEnoughData(many(5, ['add x', 'add y']))).toBe(false);
    expect(hasEnoughData(many(5, Array(6).fill('add x')))).toBe(true);
    expect(scoreUser(many(4, Array(10).fill('add x')), leverage)).toBeUndefined();
  });

  it('caps each session at 10 prompts of weight', () => {
    const spec = 'update src/cart.ts, only the reducer';
    const marathon = computeSessionSignals(
      session(
        Array.from({ length: 100 }, () => prompt('add x')),
        { id: 'marathon' },
      ),
    );
    const short = Array.from({ length: 4 }, (_, i) =>
      computeSessionSignals(
        session(
          Array(10)
            .fill(0)
            .map(() => prompt(spec)),
          { id: `s${i}` },
        ),
      ),
    );
    const s = scoreUser([marathon, ...short], leverage);
    // 4 specify-only sessions (100) at weight 10 vs one instruct-only session at weight 10,
    // whose Specification is 0.4 x its instruct opening (40) = 16.
    expect(s?.subScores.specification?.score).toBe(Math.round((4 * 100 + 1 * 16) / 5));
  });

  it('reasons hold numbers, not prompt text', () => {
    const s = scoreUser(many(5, Array(6).fill('add the secret-sauce flag')), leverage);
    expect(JSON.stringify(s)).not.toContain('secret-sauce');
  });
});

describe('pickArchetype', () => {
  const share = Object.fromEntries(TURN_CLASSES.map((c) => [c, 0])) as Record<
    (typeof TURN_CLASSES)[number],
    number
  >;
  const base = { overall: 50, sub: {}, share, interruptsPer100: 0 };

  it('puts behaviour archetypes before level archetypes', () => {
    expect(pickArchetype({ ...base, overall: 90, share: { ...share, error_paste: 0.2 } }).id).toBe(
      'error-paster',
    );
  });

  it('falls back by overall score', () => {
    expect(pickArchetype({ ...base, overall: 65 }).id).toBe('director');
    expect(pickArchetype({ ...base, overall: 45 }).id).toBe('mid-vibes');
    expect(pickArchetype({ ...base, overall: 10 }).id).toBe('passenger');
  });
});

describe('rubric v2', () => {
  const edit = (path?: string) =>
    ({ kind: 'tool_call', name: 'Edit', paths: path ? [path] : undefined }) as const;

  it('grades the opening by spec markers', () => {
    const open = (text: string) =>
      scoreSession(computeSessionSignals(session([prompt(text)]))).opening;
    expect(open('add a logout button to the header')).toBe(40);
    expect(open('add a logout button to src/Header.tsx')).toBe(70);
    expect(open("add a logout button to src/Header.tsx, don't touch the styles")).toBe(100);
    expect(open('why does the header flicker?')).toBeUndefined();
  });

  it('counts only code edits towards Verification', () => {
    const docsOnly = session([
      prompt('write the plan'),
      edit('/Users/dev/.claude/plans/plan.md'),
      edit('README.md'),
    ]);
    const code = session([prompt('add a retry to src/api.ts'), edit('src/api.ts')]);
    const unknown = session([prompt('add a retry to src/api.ts'), edit()]);
    expect(computeSessionSignals(docsOnly).editCalls).toBe(0);
    expect(scoreSession(computeSessionSignals(docsOnly)).verification).toBeUndefined();
    expect(computeSessionSignals(code).editCalls).toBe(1);
    expect(computeSessionSignals(unknown).editCalls).toBe(1);
  });

  it('credits reporting what you saw as checking', () => {
    const s = session([
      prompt('add a retry to src/api.ts'),
      edit('src/api.ts'),
      prompt('still broken, the retry fires on 404 too'),
      edit('src/api.ts'),
      prompt('I tested it locally, works now'),
    ]);
    const r = computeSessionSignals(s);
    expect(r.observed).toBe(2);
    expect(scoreSession(r).verification).toBe(100);
  });
});
