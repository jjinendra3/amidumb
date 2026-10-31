import { beforeAll, describe, expect, it } from 'vitest';
import { readCodexSessions, type Session } from '../src/sources';
import { ofKind, tempRoot, writeJsonl } from './helpers';

let n = 0;
const ts = () => `2026-10-20T10:00:${String(n++).padStart(2, '0')}.000Z`;
const rec = (type: string, payload: object) => ({ timestamp: ts(), type, payload });
const meta = (id: string, extra: object = {}) =>
  rec('session_meta', {
    id,
    timestamp: '2026-10-20T10:00:00.000Z',
    cwd: '/Users/dev/app',
    originator: 'codex_vscode',
    source: 'vscode',
    git: { branch: 'main' },
    ...extra,
  });
const userItem = (content: object[]) =>
  rec('event_msg', {
    type: 'item_completed',
    item: { type: 'UserMessage', id: `item-${n}`, content },
  });
const text = (t: string) => ({ type: 'text', text: t });
const turnContext = (extra: object) =>
  rec('turn_context', {
    approval_policy: 'on-request',
    sandbox_policy: { type: 'workspace-write' },
    collaboration_mode: { mode: 'default' },
    ...extra,
  });

let sessions: Session[];
const byId = (id: string) => sessions.find((s) => s.id === id);

beforeAll(async () => {
  const root = tempRoot();
  writeJsonl(root, '2026/10/20/rollout-main.jsonl', [
    meta('codex-main'),
    turnContext({}),
    userItem([
      text(
        '# Context from my IDE setup:\n\n## Active file: src/a.ts\n\n## Open tabs:\n- a.ts: src/a.ts\n\n## My request for Codex:\nadd a retry to fetchUser',
      ),
    ]),
    rec('response_item', {
      type: 'function_call',
      name: 'exec_command',
      arguments: JSON.stringify({ cmd: 'pnpm vitest run', workdir: '/Users/dev/app' }),
    }),
    rec('response_item', {
      type: 'custom_tool_call',
      name: 'exec',
      input: 'await tools.exec_command({ cmd: "go test ./..." })',
    }),
    rec('event_msg', {
      type: 'item_completed',
      item: { type: 'AgentMessage', content: [{ type: 'Text', text: 'Added the retry.' }] },
    }),
    userItem([text('<ide_opened_file>src/a.ts</ide_opened_file>')]),
    userItem([
      text(
        '# Response annotations:\nthis is wrong\n\n## My request for Codex:\nuse the cache instead',
      ),
    ]),
    userItem([
      text(
        '# Files pasted by the user:\nexport const a = 1;\n\n## My request:\nwhy does this fail',
      ),
    ]),
    turnContext({ collaboration_mode: { mode: 'plan' } }),
    rec('response_item', {
      type: 'function_call',
      name: 'exec_command',
      arguments: '{"cmd":"ls"}',
    }),
    rec('response_item', {
      type: 'custom_tool_call',
      name: 'apply_patch',
      input:
        '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** Add File: docs/notes.md\n+hi\n*** End Patch',
    }),
    rec('event_msg', { type: 'turn_aborted', reason: 'interrupted' }),
    turnContext({ sandbox_policy: { type: 'danger-full-access' }, approval_policy: 'never' }),
    rec('compacted', { message: '' }),
    '{"broken',
    userItem([{ type: 'local_image', path: '/tmp/x.png' }, text('look at this')]),
  ]);
  writeJsonl(root, '2026/10/20/rollout-legacy.jsonl', [
    meta('codex-legacy', { originator: 'codex_cli_rs', source: 'cli' }),
    rec('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }],
    }),
    rec('event_msg', { type: 'user_message', message: 'hello there', images: [] }),
  ]);
  writeJsonl(root, '2026/10/20/rollout-both.jsonl', [
    meta('codex-both'),
    rec('event_msg', { type: 'user_message', message: 'same prompt' }),
    userItem([text('same prompt')]),
  ]);
  writeJsonl(root, '2026/10/20/rollout-sub.jsonl', [
    meta('codex-sub', { source: { subagent: { thread_spawn: { parent_thread_id: 'p' } } } }),
    userItem([text('do the subtask')]),
  ]);
  writeJsonl(root, '2026/10/20/rollout-exec.jsonl', [
    meta('codex-exec', { source: 'exec', originator: 'codex_exec' }),
    userItem([text('judge this')]),
  ]);
  sessions = await readCodexSessions({ root });
});

describe('readCodexSessions', () => {
  it('keeps what the user wrote and drops IDE context', () => {
    expect(ofKind(byId('codex-main'), 'prompt').map((p) => p.text)).toEqual([
      'add a retry to fetchUser',
      'this is wrong\n\nuse the cache instead',
      'why does this fail',
      'look at this',
    ]);
  });

  it('flags pasted files and images', () => {
    const prompts = ofKind(byId('codex-main'), 'prompt');
    expect(prompts.map((p) => p.hasPaste)).toEqual([false, false, true, false]);
    expect(prompts.at(-1)?.images).toBe(1);
  });

  it('treats apply_patch as an edit with paths, not a command', () => {
    const patch = ofKind(byId('codex-main'), 'tool_call').find((c) => c.name === 'apply_patch');
    expect(patch?.paths).toEqual(['src/a.ts', 'docs/notes.md']);
    expect(patch?.command).toBeUndefined();
  });

  it('extracts shell commands from exec_command and code-mode exec', () => {
    expect(
      ofKind(byId('codex-main'), 'tool_call')
        .filter((c) => c.name !== 'apply_patch')
        .map((c) => c.command),
    ).toEqual(['pnpm vitest run', 'await tools.exec_command({ cmd: "go test ./..." })', 'ls']);
  });

  it('reads interrupts, modes, compactions and agent text', () => {
    const s = byId('codex-main');
    expect(ofKind(s, 'interrupt')).toEqual([expect.objectContaining({ duringTool: true })]);
    expect(ofKind(s, 'mode').map((m) => [m.permission, m.plan])).toEqual([
      ['default', false],
      ['default', true],
      ['bypass', false],
    ]);
    expect(ofKind(s, 'compaction')).toHaveLength(1);
    expect(ofKind(s, 'assistant_text').map((e) => e.text)).toEqual(['Added the retry.']);
  });

  it('reads legacy user_message events', () => {
    expect(ofKind(byId('codex-legacy'), 'prompt').map((p) => p.text)).toEqual(['hello there']);
    expect(byId('codex-legacy')?.client).toBe('cli');
  });

  it('keeps one copy when a file has both prompt formats', () => {
    expect(ofKind(byId('codex-both'), 'prompt')).toHaveLength(1);
  });

  it('fills metadata and marks subagent and exec sessions', () => {
    expect(byId('codex-main')).toMatchObject({
      tool: 'codex',
      origin: 'interactive',
      client: 'vscode',
      cwd: '/Users/dev/app',
      gitBranch: 'main',
    });
    expect(byId('codex-sub')?.origin).toBe('subagent');
    expect(byId('codex-exec')?.origin).toBe('headless');
  });
});
