import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTROL_KEYS, isValidLabel, LABEL_FIELDS, type SessionLabel } from '../src/label/fields';
import { labelsPath, loadLabels, saveLabels } from '../src/label/store';
import { renderSessionForLabel } from '../src/label/ui';
import { calibrate, orderingAgreement } from '../src/report/calibrate';
import type { SessionScore } from '../src/score/rubric';
import { prompt, session, tempRoot } from './helpers';

const label = (extra: Partial<SessionLabel> = {}): SessionLabel => ({
  kind: 'feature',
  opening: 'spec',
  steering: 'redirected',
  verification: 'checked',
  outcome: 'shipped',
  labelledAt: '2026-10-31T00:00:00.000Z',
  ...extra,
});

describe('label fields', () => {
  it('has unique option keys per field that never clash with control keys', () => {
    for (const field of LABEL_FIELDS) {
      const keys = field.options.map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const control of Object.values(CONTROL_KEYS)) expect(keys).not.toContain(control);
    }
  });

  it('validates labels', () => {
    expect(isValidLabel(label())).toBe(true);
    expect(isValidLabel({ ...label(), opening: 'great' })).toBe(false);
  });
});

describe('label store', () => {
  it('round-trips through AMIDUMB_HOME', () => {
    const path = labelsPath({ AMIDUMB_HOME: tempRoot() });
    saveLabels(path, { schema: 1, labels: { abc: label() } });
    expect(loadLabels(path).labels).toEqual({ abc: label() });
  });

  it('loads corrupt or invalid files as empty, keeping valid entries', () => {
    const dir = tempRoot();
    const corrupt = join(dir, 'corrupt.json');
    writeFileSync(corrupt, '{nope');
    expect(loadLabels(corrupt).labels).toEqual({});
    const mixed = join(dir, 'mixed.json');
    writeFileSync(mixed, JSON.stringify({ labels: { good: label(), bad: { opening: 'x' } } }));
    expect(Object.keys(loadLabels(mixed).labels)).toEqual(['good']);
  });
});

describe('renderSessionForLabel', () => {
  const s = session(
    [
      prompt(`add a retry, token is ghp_${'A1b2C3d4E5'.repeat(4)}`),
      { kind: 'tool_call', name: 'Edit' },
      { kind: 'tool_call', name: 'Edit' },
      { kind: 'tool_call', name: 'Bash', command: 'pnpm test' },
      { kind: 'assistant_text', text: 'Added the retry.' },
      prompt('ok'),
    ],
    { title: 'Retry work', startedAt: Date.parse('2026-10-20') },
  );
  const out = renderSessionForLabel(s, { index: 0, total: 3 });

  it('shows the conversation and tools, with secrets redacted', () => {
    expect(out).toContain('[1/3] 2026-10-20');
    expect(out).toContain('Retry work');
    expect(out).toContain('[REDACTED:github-token]');
    expect(out).not.toContain('A1b2C3d4E5');
    expect(out).toContain('[Edit×2, $ pnpm test]');
    expect(out).toContain('agent  Added the retry.');
  });

  it('shows no scores or derived signals', () => {
    expect(out).not.toMatch(/score|specif|steering|verification|discipline|\d+%/i);
  });
});

describe('calibration', () => {
  it('computes ordering agreement with ties as half', () => {
    expect(
      orderingAgreement([
        [90, 80, 70],
        [10, 20, 30],
      ]),
    ).toEqual({ share: 1, pairs: 9 });
    expect(
      orderingAgreement([
        [10, 20, 30],
        [90, 80, 70],
      ]),
    ).toEqual({ share: 0, pairs: 9 });
    expect(
      orderingAgreement([
        [50, 50, 50],
        [50, 50, 50],
      ])?.share,
    ).toBe(0.5);
  });

  it('needs enough sessions in two groups', () => {
    expect(
      orderingAgreement([
        [90, 80],
        [10, 20, 30],
      ]),
    ).toBeUndefined();
  });

  it('joins labels to session scores', () => {
    const scores = new Map<string, SessionScore>();
    const labels: Record<string, SessionLabel> = {};
    for (let i = 0; i < 6; i++) {
      const good = i < 3;
      scores.set(`id${i}`, {
        id: `id${i}`,
        prompts: 5,
        opening: good ? 80 : 30,
        specification: 50,
        overall: 50,
      });
      labels[`id${i}`] = label({ opening: good ? 'spec' : 'vague' });
    }
    const opening = calibrate(labels, scores).find((c) => c.field === 'opening');
    expect(opening?.rows.find((r) => r.value === 'spec')).toEqual({
      value: 'spec',
      n: 3,
      mean: 80,
    });
    expect(opening?.agreement).toEqual({ share: 1, pairs: 9 });
  });
});
