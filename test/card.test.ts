import { describe, expect, it } from 'vitest';
import type { Verdict } from '../src/judge/schema';
import { type CardInput, renderCard, wrap } from '../src/report/card';
import {
  cardElement,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  printable,
  renderCardPng,
} from '../src/report/image';
import { scoreUser } from '../src/score/rubric';
import { PERSONAS, rowsOf } from './personas';

const score = scoreUser(rowsOf(PERSONAS.architect), PERSONAS.architect.leverage);
if (!score) throw new Error('persona must score');

const verdict: Verdict = {
  verdict: 'You write specs like a lawyer and then never open the diff in src/api/user.ts.',
  points: [
    'Four constraints per prompt and zero tests requested. Bold.',
    'You approve plans faster than the agent can write them.',
    'Every session opens with a spec. Every session ends with vibes.',
  ],
  habits: ['Ask for the diff before saying yes.', 'Name the test that proves it works.', 'Stop.'],
};

const base: CardInput = {
  score,
  window: { days: 30, sessions: 6, prompts: 30 },
  ragePrompts: 2,
  secrets: 3,
};

describe('renderCard', () => {
  it('renders the full card', () => {
    expect(renderCard({ ...base, verdict, color: false })).toMatchSnapshot();
  });

  it('masks paths and identifiers in what the judge wrote', () => {
    const card = renderCard({ ...base, verdict, color: false });
    expect(card).toContain('‹file›');
    expect(card).not.toContain('src/api/user.ts');
    expect(card).not.toContain('rubric v');
  });

  it('keeps every line inside the box at narrow widths', () => {
    const card = renderCard({ ...base, verdict, columns: 50, color: false });
    expect(new Set(card.split('\n').map((l) => [...l].length)).size).toBe(1);
  });

  it('renders without a roast', () => {
    const card = renderCard({ ...base, color: false });
    expect(card).not.toContain('WHY THIS SCORE');
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

describe('card image', () => {
  const texts = (node: unknown): string[] => {
    if (typeof node === 'string') return [node];
    if (Array.isArray(node)) return node.flatMap(texts);
    if (node && typeof node === 'object' && 'props' in node) {
      return texts((node as { props: { children?: unknown } }).props.children);
    }
    return [];
  };

  it('carries the score, archetype, verdict and points, masked', () => {
    const all = texts(cardElement({ ...base, verdict })).join('\n');
    expect(all).toContain(String(score.overall));
    expect(all).toContain(score.archetype.name.toUpperCase());
    expect(all).toContain('WHY THIS SCORE');
    expect(all).toContain(verdict.points[0]);
    expect(all).not.toContain('src/api/user.ts');
    expect(all).toContain('npx amidumb');
  });

  it('drops what the fonts cannot draw', () => {
    expect(printable('nice 🔥 work\u0007 ok')).toBe('nice work ok');
  });

  it('renders a PNG at share size', async () => {
    const png = await renderCardPng({ ...base, verdict });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(IMAGE_WIDTH);
    expect(png.readUInt32BE(20)).toBe(IMAGE_HEIGHT);
  }, 20_000);
});
