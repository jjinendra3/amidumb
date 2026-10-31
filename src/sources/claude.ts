import { basename, sep } from 'node:path';
import { stripInjected } from './context';
import { listJsonl } from './files';
import { isRecord, type JsonRecord, readJsonl, str, toMs } from './jsonl';
import type { PermissionLevel, ReadOptions, Session, SessionEvent, SessionOrigin } from './types';

// Claude Code transcripts: ~/.claude/projects/<project>/<session>.jsonl, plus subagent
// transcripts under <project>/<session>/subagents/*.jsonl.

const INTERRUPT = /^\s*\[Request interrupted by user( for tool use)?\]/;
const COMMAND_NAME = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
/** Records that look like prompts but are tool or harness output. */
const NOT_A_PROMPT =
  /^\s*<(local-command-[a-z]+|task-notification|bash-input|bash-stdout|bash-stderr)>/;
/** Pre-`toolDenialKind` versions only marked rejections in the tool_result text. */
const LEGACY_REJECTION = "doesn't want to proceed";

export async function readClaudeSessions(opts: ReadOptions): Promise<Session[]> {
  const sessions: Session[] = [];
  for (const file of await listJsonl(opts.root, opts.since)) {
    const session = await readClaudeFile(file);
    if (session) sessions.push(session);
  }
  return sessions;
}

export async function readClaudeFile(file: string): Promise<Session | undefined> {
  const isSubagentFile = file.includes(`${sep}subagents${sep}`);
  const events: SessionEvent[] = [];
  let entrypoint: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let aiTitle: string | undefined;
  let customTitle: string | undefined;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let mode: { permission: PermissionLevel; plan: boolean } | undefined;

  const setMode = (raw: unknown, ts: number | undefined) => {
    if (typeof raw !== 'string') return;
    const next = mapPermissionMode(raw);
    if (mode && mode.permission === next.permission && mode.plan === next.plan) return;
    mode = next;
    events.push({ kind: 'mode', ts, ...next });
  };

  for await (const rec of readJsonl(file)) {
    const ts = toMs(rec.timestamp);
    if (ts !== undefined) {
      startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts);
      endedAt = endedAt === undefined ? ts : Math.max(endedAt, ts);
    }
    entrypoint ??= str(rec.entrypoint);
    cwd ??= str(rec.cwd);
    if (!gitBranch && str(rec.gitBranch) && rec.gitBranch !== 'HEAD')
      gitBranch = str(rec.gitBranch);

    if (rec.isSidechain === true && !isSubagentFile) continue;

    switch (rec.type) {
      case 'user':
        readUserRecord(rec, ts, events, setMode);
        break;
      case 'assistant':
        readAssistantRecord(rec, ts, events);
        break;
      case 'permission-mode':
        setMode(rec.permissionMode, ts);
        break;
      case 'system':
        if (rec.subtype === 'compact_boundary') events.push({ kind: 'compaction', ts });
        break;
      case 'ai-title':
        aiTitle = str(rec.aiTitle) ?? aiTitle;
        break;
      case 'custom-title':
        customTitle = str(rec.customTitle) ?? customTitle;
        break;
    }
  }

  if (startedAt === undefined && events.length === 0) return undefined;

  return {
    tool: 'claude-code',
    id: basename(file, '.jsonl'),
    origin: sessionOrigin(isSubagentFile, entrypoint),
    client: normalizeClient(entrypoint),
    cwd,
    gitBranch,
    title: customTitle ?? aiTitle,
    startedAt,
    endedAt,
    events,
  };
}

function readUserRecord(
  rec: JsonRecord,
  ts: number | undefined,
  events: SessionEvent[],
  setMode: (raw: unknown, ts: number | undefined) => void,
): void {
  if (
    rec.isMeta === true ||
    rec.isCompactSummary === true ||
    rec.isVisibleInTranscriptOnly === true
  ) {
    return;
  }
  const message = isRecord(rec.message) ? rec.message : {};
  const content = message.content;
  const blocks: JsonRecord[] =
    typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : Array.isArray(content)
        ? content.filter(isRecord)
        : [];

  const texts: string[] = [];
  let images = 0;
  let toolResults = 0;
  let legacyRejection = false;

  for (const block of blocks) {
    if (block.type === 'tool_result') {
      toolResults++;
      if (block.is_error === true) events.push({ kind: 'tool_error', ts });
      if (resultText(block.content).includes(LEGACY_REJECTION)) legacyRejection = true;
    } else if (block.type === 'image') {
      images++;
    } else if (block.type === 'text' && typeof block.text === 'string') {
      const interrupt = INTERRUPT.exec(block.text);
      if (interrupt) events.push({ kind: 'interrupt', ts, duringTool: Boolean(interrupt[1]) });
      else texts.push(block.text);
    }
  }

  if (toolResults > 0) {
    const denial = str(rec.toolDenialKind);
    if (denial === 'user-rejected') events.push({ kind: 'tool_rejected', ts, by: 'user' });
    else if (denial && denial !== 'cancelled')
      events.push({ kind: 'tool_rejected', ts, by: 'policy' });
    else if (!denial && legacyRejection) events.push({ kind: 'tool_rejected', ts, by: 'user' });
    return;
  }

  // Newer versions say who sent the message in `origin` and/or `turnOrigin` (they agree
  // when both are set; SDK-injected turns carry only `turnOrigin`). Trust that over markers.
  const origin = (isRecord(rec.origin) ? str(rec.origin.kind) : undefined) ?? str(rec.turnOrigin);
  if (origin !== undefined && origin !== 'human') return;

  const raw = texts.join('\n');
  if (!raw.trim() && images === 0) return;

  const command = COMMAND_NAME.exec(raw);
  if (command?.[1]) {
    events.push({ kind: 'slash_command', ts, name: command[1] });
    const args = COMMAND_ARGS.exec(raw)?.[1]?.trim();
    if (args)
      events.push({
        kind: 'prompt',
        ts,
        text: args,
        rawLength: args.length,
        hasPaste: false,
        images,
      });
    return;
  }
  if (NOT_A_PROMPT.test(raw)) return;

  const stripped = stripInjected(raw);
  if (!stripped.text && images === 0) return;

  setMode(rec.permissionMode, ts);
  events.push({
    kind: 'prompt',
    ts,
    text: stripped.text,
    rawLength: raw.length,
    hasPaste: stripped.hasPaste,
    images,
  });
}

function readAssistantRecord(
  rec: JsonRecord,
  ts: number | undefined,
  events: SessionEvent[],
): void {
  const message = isRecord(rec.message) ? rec.message : {};
  if (!Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      events.push({ kind: 'assistant_text', ts, text: block.text });
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      const input = isRecord(block.input) ? block.input : {};
      events.push({ kind: 'tool_call', ts, name: block.name, command: str(input.command) });
    }
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('\n');
}

function mapPermissionMode(raw: string): { permission: PermissionLevel; plan: boolean } {
  switch (raw) {
    case 'default':
      return { permission: 'default', plan: false };
    case 'acceptEdits':
      return { permission: 'accept-edits', plan: false };
    case 'auto':
      return { permission: 'auto', plan: false };
    case 'bypassPermissions':
      return { permission: 'bypass', plan: false };
    case 'plan':
      return { permission: 'default', plan: true };
    default:
      return { permission: 'unknown', plan: false };
  }
}

function sessionOrigin(isSubagentFile: boolean, entrypoint: string | undefined): SessionOrigin {
  if (isSubagentFile) return 'subagent';
  // `claude -p` and the Agent SDKs record an `sdk-*` entrypoint.
  if (entrypoint?.startsWith('sdk')) return 'headless';
  return 'interactive';
}

function normalizeClient(entrypoint: string | undefined): string {
  if (!entrypoint) return 'unknown';
  if (entrypoint === 'cli') return 'cli';
  if (entrypoint.includes('vscode')) return 'vscode';
  if (entrypoint.includes('desktop')) return 'desktop';
  if (entrypoint.includes('jetbrains')) return 'jetbrains';
  if (entrypoint.startsWith('sdk')) return 'headless';
  return entrypoint;
}
