import { beforeAll, describe, expect, it } from 'vitest';
import { readClaudeSessions, type Session } from '../src/sources';
import { ofKind, tempRoot, writeJsonl } from './helpers';

const base = {
  sessionId: 'sess-a',
  cwd: '/Users/dev/app',
  gitBranch: 'feat/x',
  entrypoint: 'cli',
  version: '2.1.0',
  isSidechain: false,
};
let n = 0;
const ts = () => `2026-10-20T10:00:${String(n++).padStart(2, '0')}.000Z`;
const human = (content: unknown, extra: object = {}) => ({
  ...base,
  type: 'user',
  timestamp: ts(),
  origin: { kind: 'human' },
  turnOrigin: 'human',
  permissionMode: 'default',
  message: { role: 'user', content },
  ...extra,
});
const toolResult = (content: unknown[], extra: object = {}) => ({
  ...base,
  type: 'user',
  timestamp: ts(),
  message: { role: 'user', content },
  ...extra,
});

let sessions: Session[];
const byId = (id: string) => sessions.find((s) => s.id === id);

beforeAll(async () => {
  const root = tempRoot();
  writeJsonl(root, '-Users-dev-app/sess-a.jsonl', [
    { type: 'permission-mode', permissionMode: 'default', sessionId: 'sess-a' },
    human([
      { type: 'text', text: '<ide_opened_file>The user opened src/api/user.ts</ide_opened_file>' },
      { type: 'text', text: "rename `getUser` in src/api/user.ts, don't touch tests" },
    ]),
    {
      ...base,
      type: 'assistant',
      timestamp: ts(),
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Renaming now.' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' } },
          { type: 'tool_use', id: 't5', name: 'Edit', input: { file_path: 'src/api/user.ts' } },
        ],
      },
    },
    toolResult([{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }]),
    // IDE context with nothing typed: not a prompt.
    human([{ type: 'text', text: '<ide_selection>const a = 1;</ide_selection>' }]),
    toolResult([{ type: 'text', text: '[Request interrupted by user]' }]),
    toolResult(
      [
        {
          type: 'tool_result',
          tool_use_id: 't2',
          is_error: true,
          content: "The user doesn't want to proceed with this tool use.",
        },
        { type: 'text', text: '[Request interrupted by user for tool use]' },
      ],
      { toolDenialKind: 'user-rejected' },
    ),
    toolResult([{ type: 'tool_result', tool_use_id: 't3', is_error: true, content: 'blocked' }], {
      toolDenialKind: 'automode-blocked',
    }),
    // Older versions: rejection only visible in the result text.
    toolResult([
      {
        type: 'tool_result',
        tool_use_id: 't4',
        is_error: true,
        content: [{ type: 'text', text: "The user doesn't want to proceed with this tool use." }],
      },
    ]),
    human(
      '<command-message>plan</command-message>\n<command-name>/plan</command-name>\n<command-args>add a logout button</command-args>',
    ),
    human('Skill body expanded into the prompt', { isMeta: true }),
    { type: 'permission-mode', permissionMode: 'plan', sessionId: 'sess-a' },
    human('<task-notification>build finished</task-notification>', {
      origin: { kind: 'task-notification' },
      turnOrigin: 'task_notification',
    }),
    // SDK-injected turn: carries only turnOrigin.
    {
      ...human('<system-reminder>x</system-reminder>\ninjected by the extension'),
      origin: undefined,
      turnOrigin: 'sdk',
    },
    // Pre-origin format.
    {
      ...human('still broken, fix it'),
      origin: undefined,
      turnOrigin: undefined,
      permissionMode: undefined,
    },
    '{not valid json',
    human('subagent instructions', { isSidechain: true }),
    human('<local-command-stdout>done</local-command-stdout>'),
    { ...base, type: 'system', subtype: 'compact_boundary', timestamp: ts() },
    human(
      [
        { type: 'image', source: { type: 'base64', data: '' } },
        { type: 'text', text: 'what is wrong here' },
      ],
      { permissionMode: 'plan' },
    ),
    { type: 'ai-title', aiTitle: 'Rename getUser', sessionId: 'sess-a' },
    { type: 'custom-title', customTitle: 'my title', sessionId: 'sess-a' },
  ]);
  writeJsonl(root, '-Users-dev-app/sess-headless.jsonl', [
    human('say ok', { sessionId: 'sess-headless', entrypoint: 'sdk-cli' }),
  ]);
  writeJsonl(root, '-Users-dev-app/sess-a/subagents/agent-1.jsonl', [
    human('explore the repo', { isSidechain: true, entrypoint: 'claude-vscode' }),
  ]);
  writeJsonl(root, '-Users-dev-app/sess-vscode.jsonl', [
    human('hello', { sessionId: 'sess-vscode', entrypoint: 'claude-vscode' }),
  ]);
  sessions = await readClaudeSessions({ root });
});

describe('readClaudeSessions', () => {
  it('keeps only what the human typed', () => {
    expect(ofKind(byId('sess-a'), 'prompt').map((p) => p.text)).toEqual([
      "rename `getUser` in src/api/user.ts, don't touch tests",
      'add a logout button',
      'still broken, fix it',
      'what is wrong here',
    ]);
  });

  it('records raw length and images', () => {
    const [first, , , last] = ofKind(byId('sess-a'), 'prompt');
    expect(first?.rawLength).toBeGreaterThan(first?.text.length ?? 0);
    expect(last?.images).toBe(1);
  });

  it('reads interrupts, rejections and tool errors', () => {
    const s = byId('sess-a');
    expect(ofKind(s, 'interrupt').map((e) => e.duringTool)).toEqual([false, true]);
    expect(ofKind(s, 'tool_rejected').map((e) => e.by)).toEqual(['user', 'policy', 'user']);
    expect(ofKind(s, 'tool_error')).toHaveLength(3);
  });

  it('reads slash commands, tool calls, modes and compactions', () => {
    const s = byId('sess-a');
    expect(ofKind(s, 'slash_command').map((e) => e.name)).toEqual(['plan']);
    expect(ofKind(s, 'tool_call')).toEqual([
      expect.objectContaining({ name: 'Bash', command: 'pnpm test' }),
      expect.objectContaining({ name: 'Edit', paths: ['src/api/user.ts'] }),
    ]);
    expect(ofKind(s, 'assistant_text').map((e) => e.text)).toEqual(['Renaming now.']);
    expect(ofKind(s, 'mode').map((e) => [e.permission, e.plan])).toEqual([
      ['default', false],
      ['default', true],
    ]);
    expect(ofKind(s, 'compaction')).toHaveLength(1);
  });

  it('fills session metadata', () => {
    expect(byId('sess-a')).toMatchObject({
      tool: 'claude-code',
      origin: 'interactive',
      client: 'cli',
      cwd: '/Users/dev/app',
      gitBranch: 'feat/x',
      title: 'my title',
    });
    expect(byId('sess-a')?.startedAt).toBeLessThan(byId('sess-a')?.endedAt ?? 0);
    expect(byId('sess-vscode')?.client).toBe('vscode');
  });

  it('marks headless and subagent sessions', () => {
    expect(byId('sess-headless')?.origin).toBe('headless');
    expect(byId('agent-1')?.origin).toBe('subagent');
  });

  it('returns nothing for a missing root', async () => {
    expect(await readClaudeSessions({ root: '/nonexistent/amidumb' })).toEqual([]);
  });
});
