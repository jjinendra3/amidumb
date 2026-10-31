import { basename } from 'node:path';
import { stripInjected } from './context';
import { listJsonl } from './files';
import { isRecord, type JsonRecord, readJsonl, str, toMs } from './jsonl';
import type { PermissionLevel, ReadOptions, Session, SessionEvent, SessionOrigin } from './types';

// Codex transcripts: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, one session per file.
// Records are { timestamp, type, payload }.

/** Max chars kept from a tool call's command; enough to spot test/lint runs. */
const COMMAND_LIMIT = 4000;

export async function readCodexSessions(opts: ReadOptions): Promise<Session[]> {
  const sessions: Session[] = [];
  for (const file of await listJsonl(opts.root, opts.since)) {
    const session = await readCodexFile(file);
    if (session) sessions.push(session);
  }
  return sessions;
}

type PendingEvent = SessionEvent & { legacyPrompt?: boolean };

export async function readCodexFile(file: string): Promise<Session | undefined> {
  const events: PendingEvent[] = [];
  let meta: JsonRecord | undefined;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let hasItemPrompts = false;
  let mode: { permission: PermissionLevel; plan: boolean } | undefined;

  for await (const rec of readJsonl(file)) {
    const ts = toMs(rec.timestamp);
    if (ts !== undefined) {
      startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts);
      endedAt = endedAt === undefined ? ts : Math.max(endedAt, ts);
    }
    const payload = isRecord(rec.payload) ? rec.payload : {};

    switch (rec.type) {
      case 'session_meta':
        meta ??= payload;
        break;
      case 'turn_context': {
        const next = mapTurnContext(payload);
        if (!mode || mode.permission !== next.permission || mode.plan !== next.plan) {
          mode = next;
          events.push({ kind: 'mode', ts, ...next });
        }
        break;
      }
      case 'compacted':
        events.push({ kind: 'compaction', ts });
        break;
      case 'event_msg':
        if (payload.type === 'item_completed' && isRecord(payload.item)) {
          const item = payload.item;
          if (item.type === 'UserMessage') {
            hasItemPrompts = true;
            pushPrompt(events, ts, item.content, false);
          } else if (item.type === 'AgentMessage') {
            const text = textBlocks(item.content).join('\n');
            if (text.trim()) events.push({ kind: 'assistant_text', ts, text });
          }
        } else if (payload.type === 'user_message') {
          // Older Codex versions emit this instead of a UserMessage item.
          const text = str(payload.message) ?? '';
          const images = Array.isArray(payload.images) ? payload.images.length : 0;
          pushPrompt(
            events,
            ts,
            [{ type: 'text', text }, ...Array(images).fill({ type: 'image' })],
            true,
          );
        } else if (payload.type === 'turn_aborted' && payload.reason === 'interrupted') {
          const previous = events.at(-1);
          events.push({ kind: 'interrupt', ts, duringTool: previous?.kind === 'tool_call' });
        }
        break;
      case 'response_item':
        if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
          const name = str(payload.name);
          if (name === 'apply_patch') {
            // A patch is an edit, not a shell command.
            const patch = typeof payload.input === 'string' ? payload.input : '';
            events.push({ kind: 'tool_call', ts, name, paths: patchPaths(patch) });
          } else if (name) {
            const command = commandOf(payload);
            const paths = command?.includes('apply_patch') ? patchPaths(command) : [];
            events.push({
              kind: 'tool_call',
              ts,
              name,
              command,
              paths: paths.length ? paths : undefined,
            });
          }
        }
        break;
    }
  }

  if (!meta && events.length === 0) return undefined;
  const source = meta?.source;
  const originator = str(meta?.originator);

  return {
    tool: 'codex',
    id: str(meta?.id) ?? basename(file, '.jsonl'),
    origin: sessionOrigin(source, originator),
    client: normalizeClient(source, originator),
    cwd: str(meta?.cwd),
    gitBranch: isRecord(meta?.git) ? str(meta.git.branch) : undefined,
    startedAt: toMs(meta?.timestamp) ?? startedAt,
    endedAt,
    // A file with new-style UserMessage items may also carry legacy user_message events
    // for the same prompts; keep one copy.
    events: events
      .filter((e) => !(hasItemPrompts && e.legacyPrompt))
      .map(({ legacyPrompt: _, ...e }) => e as SessionEvent),
  };
}

function pushPrompt(
  events: PendingEvent[],
  ts: number | undefined,
  content: unknown,
  legacyPrompt: boolean,
): void {
  const blocks = Array.isArray(content) ? content.filter(isRecord) : [];
  const raw = textBlocks(blocks).join('\n');
  const images = blocks.filter((b) => b.type === 'image' || b.type === 'local_image').length;
  const stripped = stripInjected(raw);
  if (!stripped.text && images === 0) return;
  events.push({
    kind: 'prompt',
    ts,
    text: stripped.text,
    rawLength: raw.length,
    hasPaste: stripped.hasPaste,
    images,
    legacyPrompt,
  });
}

function textBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((b) => (isRecord(b) && typeof b.text === 'string' ? [b.text] : []));
}

const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

/** Files named in an apply_patch body. */
function patchPaths(patch: string): string[] {
  return [...patch.matchAll(PATCH_FILE)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
}

function commandOf(payload: JsonRecord): string | undefined {
  // custom_tool_call carries raw `input` (e.g. code-mode `exec` scripts); function_call
  // carries JSON `arguments` with `cmd` (exec_command) or `command` (older shell tool).
  if (typeof payload.input === 'string') return payload.input.slice(0, COMMAND_LIMIT);
  if (typeof payload.arguments !== 'string') return undefined;
  let args: unknown;
  try {
    args = JSON.parse(payload.arguments);
  } catch {
    return undefined;
  }
  if (!isRecord(args)) return undefined;
  const command = args.cmd ?? args.command;
  if (typeof command === 'string') return command.slice(0, COMMAND_LIMIT);
  if (Array.isArray(command))
    return command
      .filter((c) => typeof c === 'string')
      .join(' ')
      .slice(0, COMMAND_LIMIT);
  return undefined;
}

function mapTurnContext(ctx: JsonRecord): { permission: PermissionLevel; plan: boolean } {
  const sandbox = isRecord(ctx.sandbox_policy)
    ? str(ctx.sandbox_policy.type)
    : str(ctx.sandbox_policy);
  const approval = ctx.approval_policy;
  const collaboration = isRecord(ctx.collaboration_mode)
    ? str(ctx.collaboration_mode.mode)
    : undefined;

  let permission: PermissionLevel = 'unknown';
  if (sandbox === 'danger-full-access') permission = 'bypass';
  else if (approval === 'never') permission = 'auto';
  else if (approval !== undefined) permission = 'default';

  return { permission, plan: collaboration === 'plan' };
}

function sessionOrigin(source: unknown, originator: string | undefined): SessionOrigin {
  if (isRecord(source) && 'subagent' in source) return 'subagent';
  if (source === 'exec' || source === 'mcp' || originator?.toLowerCase().includes('exec')) {
    return 'headless';
  }
  return 'interactive';
}

function normalizeClient(source: unknown, originator: string | undefined): string {
  const o = originator?.toLowerCase() ?? '';
  if (o.includes('desktop')) return 'desktop';
  if (o.includes('vscode')) return 'vscode';
  if (o.includes('exec')) return 'exec';
  if (o.includes('tui') || o.includes('cli')) return 'cli';
  return typeof source === 'string' ? source : (originator ?? 'unknown');
}
