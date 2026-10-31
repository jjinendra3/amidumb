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
  isRage,
  isVerifyAsk,
  isVerifyCommand,
  looksPasted,
  namesPathOrSymbol,
} from './patterns';
import { countSecrets } from './secrets';

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

  for (const event of session.events) {
    switch (event.kind) {
      case 'prompt': {
        lengths.push(event.text.length);
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

  return {
    id: hashId(`${session.tool}:${session.id}`),
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
  };
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
