import { describeWindow, type WindowInfo } from '../report/score';
import { SUB_SCORES, type UserScore } from '../score/rubric';
import type { Sample, SampleItem } from './sample';

export interface JudgeContext {
  score: UserScore;
  window: WindowInfo;
  /** Prompts with swearing, caps lock or !!!. */
  ragePrompts: number;
  /** Secrets found in prompts (all already redacted from the sample). */
  secrets: number;
}

const RULES = `You are the judge for amidumb, a tool that reads someone's AI coding transcripts and tells them whether they direct their coding agent like an engineer or just vibecode. Write their verdict like a Spotify Wrapped card with opinions: judgemental, specific and funny, never cruel, no slurs, and nothing about them as a person beyond how they work with the agent.

HOW TO JUDGE
- Judge each prompt in the context of the agent message before it. "yes" or "go" right after the agent proposed a plan is good direction; "continue" or "fix it" on repeat is vibecoding. A short prompt is not a dumb prompt.
- What separates an engineer from a vibecoder: do they specify (files, constraints, what done looks like), constrain, verify (tests, review, running it themselves) and correct with new information?
- The class next to each prompt is a rough local guess. Overrule it when the context says otherwise.
- The score and archetype below are fixed, computed locally from all their sessions. Do not change, contradict or re-score them. A high score gets roasted for its quirks, not for vibecoding; a low score gets roasted for the vibecoding.

WRITE (JSON only, matching the schema)
- verdict: one sentence, at most 200 characters.
- roast: 2 or 3 lines, each at most 180 characters, each about a pattern you can see in the sample.
- receipts: 2 or 3 sample ids (like "p12") whose prompts best prove the verdict, each with a "why" of at most 120 characters. Only ids that appear in the sample. Their prompt text is quoted from the real transcript next to your why, so don't quote it yourself.
- habits: exactly 3 habits to fix, each a one-line rule they could paste into CLAUDE.md or AGENTS.md.
- Never put file paths, URLs, code identifiers, secrets, or names of companies, products or people into verdict, roast, why or habits. People screenshot this.`;

export function buildJudgePrompt(ctx: JudgeContext, sample: Sample): string {
  const { score } = ctx;
  const facts = [
    `- direction score: ${score.overall}/100 (rubric v${score.rubricVersion})`,
    `- archetype: ${score.archetype.name}`,
    ...SUB_SCORES.flatMap((id) => {
      const sub = score.subScores[id];
      return sub ? [`- ${id} ${sub.score}/100: ${sub.reason}`] : [];
    }),
    `- prompts with swearing, caps lock or !!!: ${ctx.ragePrompts} of ${ctx.window.prompts}`,
    `- secrets pasted into prompts: ${ctx.secrets} (redacted below)`,
    `- data: ${describeWindow(ctx.window)}`,
  ];

  const lines: string[] = [];
  let session: string | undefined;
  for (const item of sample.items) {
    if (item.session !== session) {
      session = item.session;
      lines.push('', `== ${item.session} · ${item.tool}${item.date ? ` · ${item.date}` : ''}`);
    }
    lines.push(...renderItem(item));
  }

  return [
    RULES,
    '',
    'FIXED FACTS',
    ...facts,
    '',
    `SAMPLE: ${sample.items.length} of their prompts from ${sample.sessions} sessions, in order. "agent:" is the agent's last message before the prompt, "you:" is what they typed. Both are cut short.`,
    ...lines,
  ].join('\n');
}

function renderItem(item: SampleItem): string[] {
  const tags = [item.opening ? 'opening' : undefined, item.cls].filter(Boolean).join(' · ');
  return [
    `[${item.id}] ${tags}`,
    ...(item.before ? [`  agent: ${item.before}`] : []),
    `  you: ${item.prompt}`,
  ];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
