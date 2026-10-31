import { z } from 'zod';
import type { Sample, SampleItem } from './sample';

// The judge only writes words. Receipts come back as sample ids and are quoted locally,
// so a made-up quote is impossible: an id that isn't in the sample is dropped, and too
// few real ones fails the roast.

export const MIN_RECEIPTS = 2;
const MAX_RECEIPTS = 3;

/** Over-long text is cut rather than rejected: a wordy roast is still a roast. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s));

export const judgeOutputSchema = z.object({
  verdict: text(200),
  roast: z
    .array(text(180))
    .min(1)
    .transform((lines) => lines.slice(0, 3)),
  receipts: z.array(z.object({ id: z.string(), why: text(120) })).min(1),
  habits: z
    .array(text(160))
    .min(1)
    .transform((lines) => lines.slice(0, 3)),
});

/** Handed to the CLI for structured output; zod enforces the limits afterwards. */
export const JUDGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: 'One sentence, at most 200 characters.' },
    roast: {
      type: 'array',
      items: { type: 'string' },
      description: '2 or 3 lines, each at most 180 characters.',
    },
    receipts: {
      type: 'array',
      description: '2 or 3 prompts from the sample that prove the verdict.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A sample id such as "p12".' },
          why: { type: 'string', description: 'At most 120 characters.' },
        },
        required: ['id', 'why'],
        additionalProperties: false,
      },
    },
    habits: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exactly 3 one-line rules for CLAUDE.md or AGENTS.md.',
    },
  },
  required: ['verdict', 'roast', 'receipts', 'habits'],
  additionalProperties: false,
} as const;

export class JudgeError extends Error {}

export interface Receipt {
  item: SampleItem;
  why: string;
}

export interface Verdict {
  verdict: string;
  roast: string[];
  receipts: Receipt[];
  habits: string[];
}

export function resolveJudgeOutput(raw: unknown, sample: Sample): Verdict {
  const parsed = judgeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new JudgeError(
      `the judge returned an unexpected shape:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const byId = new Map(sample.items.map((item) => [item.id, item]));
  const receipts: Receipt[] = [];
  const unknown: string[] = [];
  for (const { id, why } of parsed.data.receipts) {
    const item = byId.get(id.trim().replace(/^\[|\]$/g, ''));
    if (!item) unknown.push(id);
    else if (!receipts.some((r) => r.item.id === item.id)) receipts.push({ item, why });
  }
  if (receipts.length < MIN_RECEIPTS) {
    throw new JudgeError(
      `the judge cited ${receipts.length} real prompts, need ${MIN_RECEIPTS}` +
        (unknown.length ? ` (ids not in the sample: ${unknown.join(', ')})` : ''),
    );
  }
  return { ...parsed.data, receipts: receipts.slice(0, MAX_RECEIPTS) };
}
