import pc from 'picocolors';
import { maskForCard } from '../judge/mask';
import type { Verdict } from '../judge/schema';
import { SUB_SCORES, type UserScore } from '../score/rubric';
import type { WindowInfo } from './score';

// The terminal card: score, archetype, verdict, why, rage meter, leak count, habits. The
// same input renders the PNG (image.ts). Everything the judge wrote goes through masking.

const MAX_INNER = 72;
const BAR = 20;
const RAGE_CELLS = 10;
/** A rage meter is full at this share of prompts. */
const RAGE_FULL_SHARE = 0.05;
const LABEL = 14;

export interface CardInput {
  score: UserScore;
  window: WindowInfo;
  verdict?: Verdict;
  ragePrompts: number;
  secrets: number;
  /** Terminal columns; the card is at most 76 wide. */
  columns?: number;
  color?: boolean;
}

/** Colour escape codes, which take no width on screen. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const visible = (s: string) => s.replace(ANSI, '').length;

export function renderCard(input: CardInput): string {
  const c = pc.createColors(input.color ?? pc.isColorSupported);
  const inner = Math.max(40, Math.min(MAX_INNER, (input.columns ?? 80) - 4));
  const mask = maskForCard;
  const { score, verdict } = input;
  const body: string[] = [];
  const blank = () => body.push('');
  const para = (text: string, style: (s: string) => string = (s) => s, indent = '') => {
    for (const line of wrap(text, inner - indent.length)) body.push(indent + style(line));
  };
  /** `label` in a fixed column, `value` wrapped beside it. */
  const field = (label: string, value: string) => {
    const [first = '', ...rest] = wrap(value, inner - LABEL);
    body.push(label.padEnd(LABEL) + first, ...rest.map((l) => ' '.repeat(LABEL) + l));
  };

  const tone = score.overall >= 70 ? c.green : score.overall >= 40 ? c.yellow : c.red;
  body.push(c.dim('amidumb · your AI coding transcripts, judged'));
  blank();
  body.push(
    `${tone(c.bold(`${score.overall}/100`))}  ${c.bold(score.archetype.name.toUpperCase())}`,
  );
  if (verdict) para(mask(verdict.verdict), c.italic);
  blank();

  for (const id of SUB_SCORES) {
    const sub = score.subScores[id];
    const value = sub ? String(sub.score).padStart(3) : '  –';
    const filled = sub ? Math.round((sub.score / 100) * BAR) : 0;
    body.push(
      `${id.padEnd(LABEL)}${value}  ${tone('█'.repeat(filled))}${c.dim('░'.repeat(BAR - filled))}`,
    );
  }

  if (verdict) {
    blank();
    body.push(c.bold('WHY THIS SCORE'));
    for (const point of verdict.points) {
      const [first = '', ...rest] = wrap(mask(point), inner - 2);
      body.push(`${tone('→')} ${first}`, ...rest.map((l) => `  ${l}`));
    }
  }

  blank();
  const rageShare = input.window.prompts ? input.ragePrompts / input.window.prompts : 0;
  const rageCells = Math.round(Math.min(1, rageShare / RAGE_FULL_SHARE) * RAGE_CELLS);
  field(
    'rage meter',
    `${c.red('█'.repeat(rageCells))}${c.dim('░'.repeat(RAGE_CELLS - rageCells))} ` +
      (input.ragePrompts
        ? `${input.ragePrompts} prompts with swearing, CAPS or !!!`
        : 'no swearing, CAPS or !!!'),
  );
  field(
    'secrets',
    input.secrets
      ? `${c.yellow(String(input.secrets))} pasted into prompts ${c.dim('(redacted before judging)')}`
      : 'none pasted into prompts',
  );

  if (verdict) {
    blank();
    body.push(c.bold('FIX THESE'));
    verdict.habits.forEach((habit, i) => {
      const [first = '', ...rest] = wrap(mask(habit), inner - 3);
      body.push(`${i + 1}. ${first}`, ...rest.map((l) => `   ${l}`));
    });
  }

  blank();
  para(
    `rubric v${score.rubricVersion} · ${input.window.sessions} sessions · ${input.window.prompts} prompts · npx amidumb`,
    c.dim,
  );

  const top = `╭${'─'.repeat(inner + 2)}╮`;
  const bottom = `╰${'─'.repeat(inner + 2)}╯`;
  const rows = body.map((line) => `│ ${line}${' '.repeat(Math.max(0, inner - visible(line)))} │`);
  return [top, ...rows, bottom].join('\n');
}

/** Word wrap on visible width; words longer than a line are split. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (visible(w) > width) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!line) line = w;
    else if (visible(line) + 1 + visible(w) <= width) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
