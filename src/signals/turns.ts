import type { Session } from '../sources';
import {
  fixItRemainder,
  isApproval,
  isContinue,
  isCorrection,
  isErrorOnly,
  isFixIt,
  isQuestion,
  isVerifyAsk,
  namesPathOrSymbol,
  specMarkers,
} from './patterns';

// Judges each prompt against the agent turn before it. "yes" after a plan is direction;
// "yes" after a status report is a nudge; "fix it" with nothing new is a retry.

export const TURN_CLASSES = [
  'specify',
  'instruct',
  'question',
  'approve',
  'nudge',
  'correct',
  'verify',
  'retry',
  'error_paste',
] as const;

export type TurnClass = (typeof TURN_CLASSES)[number];

export interface Turn {
  cls: TurnClass;
  /** The agent's previous turn proposed something or asked a question. */
  afterProposal: boolean;
}

const PROPOSAL =
  /(\bshould i\b|\bshall i\b|\bwant me to\b|\bdo you want\b|\bwould you like\b|\blet me know\b|\bif you want\b|\bif you'?d like\b|\bi can (also|next|then)\b|\bplan:|\bhere'?s (the|my) plan\b|^#+ *plan\b|\boption [a-c1-3]\b|\bproposed?\b|\bconfirm\b|\bproceed\?)/im;
/** Tools that hand a plan or a question to the user. */
const PROPOSAL_TOOLS = new Set(['ExitPlanMode', 'AskUserQuestion']);
/** Below this many chars of new information, a fix-it prompt is a plain retry. */
const RETRY_INFO_CHARS = 15;
const SPECIFY_MIN_CHARS = 25;
/** A prompt this long with spec markers is a spec even if it ends with a question. */
const LONG_SPEC_CHARS = 120;

export function isProposal(agentText: string | undefined, tools: ReadonlySet<string>): boolean {
  if ([...tools].some((t) => PROPOSAL_TOOLS.has(t))) return true;
  if (!agentText) return false;
  return agentText.trimEnd().endsWith('?') || PROPOSAL.test(agentText);
}

/**
 * `isFirst`: the session's opening prompt. Nothing has happened yet to correct, so
 * "use X instead of Y" there is part of the spec, not a correction.
 */
export function classifyPrompt(text: string, afterProposal: boolean, isFirst = false): TurnClass {
  if (isErrorOnly(text)) return 'error_paste';
  if (isFixIt(text)) {
    const hasInfo = fixItRemainder(text).length >= RETRY_INFO_CHARS || namesPathOrSymbol(text);
    if (!hasInfo) return 'retry';
    if (!isFirst) return 'correct';
  } else if (!isFirst && isCorrection(text)) {
    return 'correct';
  }
  if (isVerifyAsk(text)) return 'verify';
  if (isApproval(text) || isContinue(text)) return afterProposal ? 'approve' : 'nudge';
  const markers = specMarkers(text);
  if (markers > 0 && text.length >= LONG_SPEC_CHARS) return 'specify';
  if (isQuestion(text)) return 'question';
  if (markers > 0 && text.length >= SPECIFY_MIN_CHARS) return 'specify';
  return 'instruct';
}

/** One entry per prompt event, in order. */
export function classifyTurns(session: Session): Turn[] {
  const turns: Turn[] = [];
  let agentText: string | undefined;
  let tools = new Set<string>();
  for (const event of session.events) {
    if (event.kind === 'assistant_text') {
      agentText = event.text;
    } else if (event.kind === 'tool_call') {
      tools.add(event.name);
    } else if (event.kind === 'prompt') {
      const isFirst = turns.length === 0;
      const afterProposal = !isFirst && isProposal(agentText, tools);
      turns.push({ cls: classifyPrompt(event.text, afterProposal, isFirst), afterProposal });
      agentText = undefined;
      tools = new Set();
    }
  }
  return turns;
}
