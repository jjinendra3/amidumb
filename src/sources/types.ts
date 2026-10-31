// Normalized shape for agent transcripts. Nothing in src/sources knows about scoring,
// so this folder can be pulled out into a standalone package later.

export type AgentTool = 'claude-code' | 'codex';

/** Who drove the session. Only `interactive` sessions reflect how a human directs an agent. */
export type SessionOrigin = 'interactive' | 'headless' | 'subagent';

export type PermissionLevel = 'default' | 'accept-edits' | 'auto' | 'bypass' | 'unknown';

export type SessionEvent =
  | {
      kind: 'prompt';
      ts?: number;
      /** What the human typed, with IDE and tool-injected context stripped. */
      text: string;
      /** Length before stripping, including pasted context blocks. */
      rawLength: number;
      hasPaste: boolean;
      images: number;
    }
  | { kind: 'assistant_text'; ts?: number; text: string }
  | { kind: 'tool_call'; ts?: number; name: string; command?: string }
  | { kind: 'tool_error'; ts?: number }
  | { kind: 'interrupt'; ts?: number; duringTool: boolean }
  | { kind: 'tool_rejected'; ts?: number; by: 'user' | 'policy' }
  | { kind: 'slash_command'; ts?: number; name: string }
  | { kind: 'mode'; ts?: number; permission: PermissionLevel; plan: boolean }
  | { kind: 'compaction'; ts?: number };

export type SessionEventKind = SessionEvent['kind'];

export interface Session {
  tool: AgentTool;
  id: string;
  origin: SessionOrigin;
  /** Normalized client: 'cli' | 'vscode' | 'desktop' | 'exec' | raw value when unknown. */
  client: string;
  cwd?: string;
  gitBranch?: string;
  title?: string;
  startedAt?: number;
  endedAt?: number;
  events: SessionEvent[];
}

export interface ReadOptions {
  /** Root directory of the tool's transcripts. */
  root: string;
  /** Epoch ms. Files last modified before this are skipped. */
  since?: number;
}
