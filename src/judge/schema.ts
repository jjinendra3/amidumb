import { z } from 'zod';
import type { Sample } from './sample';

// The judge only writes words. Every point it makes must cite sample ids as evidence;
// the ids are checked against what was actually sent and never shown. A point whose
// evidence isn't in the sample is dropped, and too few grounded points fails the roast.

export const MIN_POINTS = 2;
const MAX_POINTS = 3;

/** Over-long text is cut rather than rejected: a wordy roast is still a roast. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s));

export const judgeOutputSchema = z.object({
  verdict: text(140),
  points: z.array(z.object({ text: text(120), evidence: z.array(z.string()) })).min(1),
  habits: z
    .array(text(160))
    .min(1)
    .transform((lines) => lines.slice(0, 3)),
});

/** Handed to the CLI for structured output; zod enforces the limits afterwards. */
export const JUDGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: 'One-line headline roast, at most 140 characters.' },
    points: {
      type: 'array',
      description: 'Exactly 3 reasons for the score.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'At most 120 characters.' },
          evidence: {
            type: 'array',
            items: { type: 'string' },
            description: '1 to 3 sample ids such as "p12" that show it.',
          },
        },
        required: ['text', 'evidence'],
        additionalProperties: false,
      },
    },
    habits: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exactly 3 one-line rules for CLAUDE.md or AGENTS.md.',
    },
  },
  required: ['verdict', 'points', 'habits'],
  additionalProperties: false,
} as const;

export class JudgeError extends Error {}

export interface Verdict {
  verdict: string;
  /** Why the score is what it is, each backed by at least one real sample id. */
  points: string[];
  habits: string[];
}

export function resolveJudgeOutput(raw: unknown, sample: Sample): Verdict {
  const parsed = judgeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new JudgeError(
      `the judge returned an unexpected shape:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const ids = new Set(sample.items.map((item) => item.id));
  const cited = (id: string) => ids.has(id.trim().replace(/^\[|\]$/g, ''));
  const grounded = parsed.data.points.filter((p) => p.evidence.some(cited));
  if (grounded.length < MIN_POINTS) {
    const dropped = parsed.data.points.length - grounded.length;
    throw new JudgeError(
      `the judge backed ${grounded.length} points with real prompts, need ${MIN_POINTS}` +
        (dropped ? ` (${dropped} cited ids that were never sent)` : ''),
    );
  }
  return {
    verdict: parsed.data.verdict,
    points: grounded.slice(0, MAX_POINTS).map((p) => p.text),
    habits: parsed.data.habits,
  };
}
