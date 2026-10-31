import { describe, expect, it } from 'vitest';
import type { SampleItem } from '../src/judge/sample';
import type { Verdict } from '../src/judge/schema';
import { renderCard, wrap } from '../src/report/card';
import { scoreUser } from '../src/score/rubric';
import { PERSONAS, rowsOf } from './personas';

const score = scoreUser(rowsOf(PERSONAS.architect), PERSONAS.architect.leverage);
if (!score) throw new Error('persona must score');

const item = (id: string, prompt: string): SampleItem => ({
  id,
  session: 's1',
  tool: 'claude-code',
  cls: 'specify',
  opening: true,
  afterProposal: false,
  prompt,
});

const verdict: Verdict = {
  verdict: 'You write specs like a lawyer and then never open the diff.',
  roast: [
    'Four constraints per prompt and zero tests requested. Bold.',
    'You approve plans faster than the agent can write them.',
  ],
  receipts: [
    {
      item: item('p3', 'Add a retry to fetchUser in src/api/user.ts, only on 5xx'),
      why: 'spec of the year',
    },
    { item: item('p9', 'yes'), why: 'said in 0.4 seconds' },
  ],
  habits: ['Ask for the diff before saying yes.', 'Name the test that proves it works.', 'Stop.'],
};

const base = {
  score,
  window: { days: 30 as const, widened: false, sessions: 6, prompts: 30 },
  ragePrompts: 2,
  secrets: 3,
  unmask: false,
  color: false,
};

describe('renderCard', () => {
  it('renders the full card', () => {
    expect(renderCard({ ...base, verdict })).toMatchSnapshot();
  });

  it('masks receipts by default and not with --unmask', () => {
    const masked = renderCard({ ...base, verdict });
    expect(masked).toContain('“Add a retry to ‹code› in ‹file›, only on 5xx”');
    expect(masked).not.toContain('src/api/user.ts');
    expect(renderCard({ ...base, verdict, unmask: true })).toContain('src/api/user.ts');
  });

  it('keeps every line inside the box at narrow widths', () => {
    const card = renderCard({ ...base, verdict, columns: 50 });
    const widths = new Set(card.split('\n').map((l) => [...l].length));
    expect(widths.size).toBe(1);
  });

  it('renders without a roast', () => {
    const card = renderCard(base);
    expect(card).not.toContain('THE ROAST');
    expect(card).toContain('rage meter');
    expect(card).toContain('3 pasted into prompts');
  });
});

describe('wrap', () => {
  it('wraps on words and splits words longer than a line', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});

describe('receipt reasons', () => {
  it('show the arrow once, even when the reason wraps', () => {
    const long: Verdict = {
      ...verdict,
      receipts: verdict.receipts.map((r) => ({ ...r, why: 'word '.repeat(30).trim() })),
    };
    const card = renderCard({ ...base, verdict: long, columns: 50 });
    expect(card.match(/↳/g)).toHaveLength(2);
  });
});
