// Session labels record what happened, not how good it was: "did you name files before the
// agent started?" is much harder to bias than "were you good?". Used only to sanity-check
// the rubric, never to fit it.

export const LABEL_FIELDS = [
  {
    key: 'kind',
    question: 'What kind of session was this?',
    options: [
      { value: 'feature', key: 'f', help: 'new behaviour' },
      { value: 'bugfix', key: 'b', help: 'fixing something broken' },
      { value: 'refactor', key: 'r', help: 'same behaviour, better code' },
      { value: 'explore', key: 'e', help: 'questions, reading, research' },
      { value: 'ops', key: 'o', help: 'config, deploys, infra, scripts' },
      { value: 'other', key: 't', help: 'none of these' },
    ],
  },
  {
    key: 'opening',
    question: 'How did you open it?',
    options: [
      { value: 'spec', key: 's', help: 'goal + where + constraints or done-criteria' },
      { value: 'goal', key: 'g', help: 'clear goal, no constraints or criteria' },
      { value: 'vague', key: 'v', help: '"build X" / "make it work"' },
      { value: 'error', key: 'e', help: 'opened by pasting an error' },
    ],
  },
  {
    key: 'steering',
    question: 'When it went off track, what did you do?',
    options: [
      { value: 'redirected', key: 'r', help: 'said what was wrong and what to do instead' },
      { value: 'retried', key: 't', help: '"fix it" / "still broken" / re-pasted, no new info' },
      { value: 'not-needed', key: 'n', help: 'it never went off track' },
      { value: 'abandoned', key: 'a', help: 'gave up or restarted' },
    ],
  },
  {
    key: 'verification',
    question: 'How did you know it worked?',
    options: [
      { value: 'checked', key: 'c', help: 'you ran, read, reviewed, or demanded tests' },
      { value: 'agent-checked', key: 'a', help: 'the agent tested without being asked' },
      { value: 'trusted', key: 't', help: 'accepted it without checking' },
      { value: 'n/a', key: 'n', help: 'no code change' },
    ],
  },
  {
    key: 'outcome',
    question: 'How did it end?',
    options: [
      { value: 'shipped', key: 's', help: 'done and used' },
      { value: 'partial', key: 'p', help: 'some of it landed' },
      { value: 'failed', key: 'f', help: 'nothing usable' },
      { value: 'exploration', key: 'e', help: 'nothing was meant to ship' },
    ],
  },
] as const;

type Field = (typeof LABEL_FIELDS)[number];
export type LabelFieldKey = Field['key'];
export type LabelValue<K extends LabelFieldKey> = Extract<
  Field,
  { key: K }
>['options'][number]['value'];

export type SessionLabel = { [K in LabelFieldKey]: LabelValue<K> } & { labelledAt: string };

/** Keys reserved by the labelling UI; no option may use them. */
export const CONTROL_KEYS = { quit: 'q', skip: 'x' } as const;

export function isValidLabel(value: unknown): value is SessionLabel {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.labelledAt === 'string' &&
    LABEL_FIELDS.every((f) => f.options.some((o) => o.value === record[f.key]))
  );
}
