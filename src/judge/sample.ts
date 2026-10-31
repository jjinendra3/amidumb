import { createHash } from 'node:crypto';
import { isRage } from '../signals/patterns';
import { redactSecrets } from '../signals/secrets';
import { classifyTurns, type TurnClass } from '../signals/turns';
import type { AgentTool, Session } from '../sources';

// Picks what the judge sees: a few hundred lines, not the transcript. Tool output never
// leaves the machine, secrets are redacted, and every turn class is represented so the
// judge has material for receipts either way.

export const MAX_ITEMS = 150;
/** About 27k tokens of sample, so the whole judge prompt stays near 30k. */
export const MAX_CHARS = 110_000;
const PROMPT_CHARS = 500;
const BEFORE_CHARS = 300;
/** Per-item overhead in the judge prompt (id, class, labels). */
const ITEM_OVERHEAD = 40;

type Bucket = TurnClass | 'opening' | 'rage' | 'longest';

/** Filled in order; the rest of the budget goes to a random pick from everything else. */
const QUOTAS: ReadonlyArray<readonly [Bucket, number]> = [
  ['error_paste', 12],
  ['retry', 12],
  ['rage', 10],
  ['nudge', 12],
  ['correct', 15],
  ['opening', 15],
  ['approve', 10],
  ['verify', 10],
  ['question', 8],
  ['longest', 6],
  ['specify', 15],
  ['instruct', 15],
];

export interface SampleItem {
  /** `p1`, `p2`… in session order. The judge cites these; receipts are quoted locally. */
  id: string;
  /** `s1`, `s2`… in time order. */
  session: string;
  tool: AgentTool;
  date?: string;
  cls: TurnClass;
  opening: boolean;
  afterProposal: boolean;
  /** What the human typed: redacted, on one line, cut short. */
  prompt: string;
  /** The agent's last message before the prompt: redacted, on one line, cut short. */
  before?: string;
}

export interface Sample {
  items: SampleItem[];
  sessions: number;
  /** Chars of prompt and agent text included. */
  chars: number;
  /** Secrets replaced in the included text. */
  redacted: number;
}

interface Candidate {
  index: number;
  sessionOrder: number;
  position: number;
  session: Session;
  cls: TurnClass;
  opening: boolean;
  afterProposal: boolean;
  prompt: string;
  before?: string;
  redacted: number;
  rage: boolean;
  length: number;
}

export function buildSample(sessions: readonly Session[]): Sample {
  const ordered = [...sessions].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const candidates = ordered.flatMap((session, sessionOrder) =>
    candidatesOf(session, sessionOrder),
  );
  candidates.forEach((c, i) => {
    c.index = i;
  });

  const rng = seeded(ordered.map((s) => `${s.tool}:${s.id}`).join('|'));
  const shuffled = shuffle(candidates, rng);
  const picked = new Map<number, Candidate>();
  let chars = 0;
  const take = (c: Candidate): boolean => {
    if (picked.has(c.index) || picked.size >= MAX_ITEMS) return false;
    const cost = c.prompt.length + (c.before?.length ?? 0) + ITEM_OVERHEAD;
    if (chars + cost > MAX_CHARS) return false;
    picked.set(c.index, c);
    chars += cost;
    return true;
  };

  for (const [bucket, quota] of QUOTAS) {
    let taken = 0;
    for (const c of pool(bucket, shuffled, candidates)) {
      if (taken >= quota) break;
      if (take(c)) taken++;
    }
  }
  for (const c of shuffled) take(c);

  const chosen = [...picked.values()].sort((a, b) => a.index - b.index);
  const sessionLabels = new Map<number, string>();
  const items = chosen.map((c, i): SampleItem => {
    if (!sessionLabels.has(c.sessionOrder)) {
      sessionLabels.set(c.sessionOrder, `s${sessionLabels.size + 1}`);
    }
    return {
      id: `p${i + 1}`,
      session: sessionLabels.get(c.sessionOrder) as string,
      tool: c.session.tool,
      date: c.session.startedAt
        ? new Date(c.session.startedAt).toISOString().slice(0, 10)
        : undefined,
      cls: c.cls,
      opening: c.opening,
      afterProposal: c.afterProposal,
      prompt: c.prompt,
      before: c.before,
    };
  });

  return {
    items,
    sessions: sessionLabels.size,
    chars: items.reduce((n, i) => n + i.prompt.length + (i.before?.length ?? 0), 0),
    redacted: chosen.reduce((n, c) => n + c.redacted, 0),
  };
}

function candidatesOf(session: Session, sessionOrder: number): Candidate[] {
  const turns = classifyTurns(session);
  const out: Candidate[] = [];
  let agentText: string | undefined;
  let position = 0;
  for (const event of session.events) {
    if (event.kind === 'assistant_text') {
      agentText = event.text;
      continue;
    }
    if (event.kind !== 'prompt') continue;
    const turn = turns[position];
    const opening = position === 0;
    position++;
    const before = agentText;
    agentText = undefined;
    if (!turn || !event.text.trim()) continue;

    // Redact before cutting, so a secret straddling the cut can't leak half of itself.
    const prompt = redactSecrets(event.text);
    const agent = before === undefined ? undefined : redactSecrets(before);
    out.push({
      index: 0,
      sessionOrder,
      position,
      session,
      cls: turn.cls,
      opening,
      afterProposal: turn.afterProposal,
      prompt: clip(prompt.text, PROMPT_CHARS),
      before: agent && !opening ? clip(agent.text, BEFORE_CHARS) : undefined,
      redacted: prompt.count + (agent?.count ?? 0),
      rage: isRage(event.text),
      length: event.text.length,
    });
  }
  return out;
}

function pool(bucket: Bucket, shuffled: Candidate[], all: Candidate[]): Iterable<Candidate> {
  switch (bucket) {
    case 'opening':
      return shuffled.filter((c) => c.opening);
    case 'rage':
      return shuffled.filter((c) => c.rage);
    case 'longest':
      return [...all].sort((a, b) => b.length - a.length);
    default:
      return shuffled.filter((c) => c.cls === bucket);
  }
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Same sessions, same sample: reruns don't reshuffle the evidence. */
function seeded(key: string): () => number {
  let state = createHash('sha256').update(key).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
