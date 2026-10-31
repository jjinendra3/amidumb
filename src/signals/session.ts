import { createHash } from 'node:crypto';
import type { AgentTool, PermissionLevel, Session } from '../sources';
import {
  hasAcceptance,
  hasConstraint,
  isApproval,
  isContinue,
  isCorrection,
  isErrorOnly,
  isFixIt,
  isObservation,
  isRage,
  isVerifyAsk,
  isVerifyCommand,
  looksPasted,
  namesPathOrSymbol,
  specMarkers,
} from './patterns';
import { countSecrets } from './secrets';
import { classifyTurns, TURN_CLASSES, type TurnClass } from './turns';

/** Prompt-level classifiers counted per session, in report order. */
export const PROMPT_FLAGS = {
  pathOrSymbol: namesPathOrSymbol,
  constraint: hasConstraint,
  acceptance: hasAcceptance,
  verifyAsk: isVerifyAsk,
  correction: isCorrection,
  approval: isApproval,
  continue: isContinue,
  fixIt: isFixIt,
  errorOnly: isErrorOnly,
  rage: isRage,
} as const satisfies Record<string, (text: string) => boolean>;

export type PromptFlag = keyof typeof PROMPT_FLAGS;

/** Gaps longer than this between events don't count as active time. */
const IDLE_GAP_MS = 15 * 60_000;
const PLAN_TOOLS = new Set(['EnterPlanMode', 'ExitPlanMode']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']);
/** Writes that aren't code: prose files, and agent plans and memory under ~/.claude or ~/.codex. */
const NOT_CODE = /(\.(md|mdx|txt|rst)$)|(^|\/)\.(claude|codex)\//i;

/** Unknown paths count as code, so formats without paths keep their old behaviour. */
function touchesCode(paths: readonly string[] | undefined): boolean {
  return !paths?.length || paths.some((p) => !NOT_CODE.test(p));
}

/** Numbers only: nothing here may contain prompt text, paths or titles. */
export interface SessionSignals {
  /** Truncated sha256 of the session id. */
  id: string;
  tool: AgentTool;
  client: string;
  startedAt?: number;
  activeMinutes: number;
  prompts: number;
  promptChars: { median: number; p90: number };
  /** Prompts matching each classifier. */
  flags: Record<PromptFlag, number>;
  pasted: number;
  images: number;
  /** Longest run of consecutive fix-it / error-only prompts. */
  longestFixStreak: number;
  interrupts: number;
  rejectedByUser: number;
  rejectedByPolicy: number;
  slashCommands: number;
  planUsed: boolean;
  promptsByPermission: Partial<Record<PermissionLevel, number>>;
  toolCalls: number;
  shellCalls: number;
  verifyCommands: number;
  toolErrors: number;
  compactions: number;
  secrets: number;
  /** Prompts per turn class, judged against the agent turn before each. */
  turns: Record<TurnClass, number>;
  /** Class of the first prompt; undefined when the session has none. */
  opening?: TurnClass;
  /** Longest run of consecutive nudges ("continue", "ok" with nothing proposed). */
  longestNudgeRun: number;
  /** Tool calls that change code files (not docs, plans or agent memory). */
  editCalls: number;
  /** Spec markers (where, constraint, done-criteria) in the opening prompt, 0-3. */
  openingMarkers: number;
  /** Prompts reporting what the human saw when running the result: they checked it. */
  observed: number;
}

export function computeSessionSignals(session: Session): SessionSignals {
  const flags = Object.fromEntries(Object.keys(PROMPT_FLAGS).map((k) => [k, 0])) as Record<
    PromptFlag,
    number
  >;
  const lengths: number[] = [];
  const promptsByPermission: Partial<Record<PermissionLevel, number>> = {};
  let permission: PermissionLevel = 'unknown';
  let pasted = 0;
  let images = 0;
  let fixStreak = 0;
  let longestFixStreak = 0;
  let interrupts = 0;
  let rejectedByUser = 0;
  let rejectedByPolicy = 0;
  let slashCommands = 0;
  let planUsed = false;
  let toolCalls = 0;
  let shellCalls = 0;
  let verifyCommands = 0;
  let toolErrors = 0;
  let compactions = 0;
  let secrets = 0;
  let editCalls = 0;
  const texts: string[] = [];

  for (const event of session.events) {
    switch (event.kind) {
      case 'prompt': {
        lengths.push(event.text.length);
        texts.push(event.text);
        promptsByPermission[permission] = (promptsByPermission[permission] ?? 0) + 1;
        for (const key of Object.keys(PROMPT_FLAGS) as PromptFlag[]) {
          if (PROMPT_FLAGS[key](event.text)) flags[key]++;
        }
        if (event.hasPaste || looksPasted(event.text)) pasted++;
        images += event.images;
        secrets += countSecrets(event.text);
        if (isFixIt(event.text) || isErrorOnly(event.text)) {
          fixStreak++;
          longestFixStreak = Math.max(longestFixStreak, fixStreak);
        } else {
          fixStreak = 0;
        }
        break;
      }
      case 'mode':
        permission = event.permission;
        if (event.plan) planUsed = true;
        break;
      case 'tool_call':
        toolCalls++;
        if (PLAN_TOOLS.has(event.name)) planUsed = true;
        if (
          (EDIT_TOOLS.has(event.name) || event.command?.includes('apply_patch')) &&
          touchesCode(event.paths)
        ) {
          editCalls++;
        }
        if (event.command !== undefined) {
          shellCalls++;
          if (isVerifyCommand(event.command)) verifyCommands++;
        }
        break;
      case 'interrupt':
        interrupts++;
        break;
      case 'tool_rejected':
        if (event.by === 'user') rejectedByUser++;
        else rejectedByPolicy++;
        break;
      case 'tool_error':
        toolErrors++;
        break;
      case 'slash_command':
        slashCommands++;
        if (event.name === 'plan') planUsed = true;
        break;
      case 'compaction':
        compactions++;
        break;
    }
  }

  const classified = classifyTurns(session);
  const turns = Object.fromEntries(TURN_CLASSES.map((c) => [c, 0])) as Record<TurnClass, number>;
  let nudgeRun = 0;
  let longestNudgeRun = 0;
  let observed = 0;
  for (const [i, { cls }] of classified.entries()) {
    turns[cls]++;
    nudgeRun = cls === 'nudge' ? nudgeRun + 1 : 0;
    longestNudgeRun = Math.max(longestNudgeRun, nudgeRun);
    const text = texts[i] ?? '';
    // "still broken: total is 0 with a coupon" means they ran it and looked.
    if (isObservation(text) || (cls === 'correct' && isFixIt(text))) observed++;
  }

  return {
    id: sessionHash(session),
    tool: session.tool,
    client: session.client,
    startedAt: session.startedAt,
    activeMinutes: activeMinutes(session),
    prompts: lengths.length,
    promptChars: { median: quantile(lengths, 0.5), p90: quantile(lengths, 0.9) },
    flags,
    pasted,
    images,
    longestFixStreak,
    interrupts,
    rejectedByUser,
    rejectedByPolicy,
    slashCommands,
    planUsed,
    promptsByPermission,
    toolCalls,
    shellCalls,
    verifyCommands,
    toolErrors,
    compactions,
    secrets,
    turns,
    opening: classified[0]?.cls,
    longestNudgeRun,
    editCalls,
    openingMarkers: texts[0] === undefined ? 0 : specMarkers(texts[0]),
    observed,
  };
}

/** Stable, non-reversible session key shared by --json rows and labels. */
export function sessionHash(session: Pick<Session, 'tool' | 'id'>): string {
  return hashId(`${session.tool}:${session.id}`);
}

export function hashId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

function activeMinutes(session: Session): number {
  let total = 0;
  let previous: number | undefined;
  for (const { ts } of session.events) {
    if (ts === undefined) continue;
    if (previous !== undefined && ts > previous) total += Math.min(ts - previous, IDLE_GAP_MS);
    previous = ts;
  }
  return Math.round(total / 60_000);
}
