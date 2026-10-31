import { spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { JUDGE_JSON_SCHEMA, JudgeError } from './schema';

// Runs the judge on the user's own CLI and plan: no API keys, no network calls of ours.
// Both runs are ephemeral, so the judge never shows up in the transcripts it judges.

export const JUDGE_CLIS = ['claude', 'codex'] as const;
export type JudgeCli = (typeof JUDGE_CLIS)[number];

const TIMEOUT_MS = 5 * 60_000;
const CLAUDE_BRIEF = 'Follow the instructions in the input and reply with the JSON only.';
/** The judge only reads the prompt; it gets no tools. */
const CLAUDE_DENIED_TOOLS =
  'Bash Edit Write Read Glob Grep WebFetch WebSearch Task Agent NotebookEdit TodoWrite';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type Exec = (
  cmd: string,
  args: readonly string[],
  opts: { input: string; cwd: string; timeoutMs: number },
) => Promise<ExecResult>;

export const runProcess: Exec = (cmd, args, { input, cwd, timeoutMs }) =>
  new Promise((resolve) => {
    const child = spawn(cmd, [...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });

/** The first judge CLI on PATH, Claude Code first. */
export function detectJudge(env: NodeJS.ProcessEnv = process.env): JudgeCli | undefined {
  return JUDGE_CLIS.find((cli) => onPath(cli, env));
}

function onPath(name: string, env: NodeJS.ProcessEnv): boolean {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      try {
        accessSync(join(dir, name + ext), constants.X_OK);
        return true;
      } catch {}
    }
  }
  return false;
}

/** Sends the prompt and returns the judge's parsed JSON (not yet validated). */
export async function runJudge(
  cli: JudgeCli,
  prompt: string,
  exec: Exec = runProcess,
): Promise<unknown> {
  // An empty working dir, so neither CLI picks up project files or instructions.
  const dir = mkdtempSync(join(tmpdir(), 'amidumb-judge-'));
  try {
    return cli === 'claude'
      ? await runClaude(prompt, dir, exec)
      : await runCodex(prompt, dir, exec);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runClaude(prompt: string, cwd: string, exec: Exec): Promise<unknown> {
  const res = await exec(
    'claude',
    [
      '-p',
      CLAUDE_BRIEF,
      '--safe-mode',
      '--no-session-persistence',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(JUDGE_JSON_SCHEMA),
      '--disallowedTools',
      CLAUDE_DENIED_TOOLS,
    ],
    { input: prompt, cwd, timeoutMs: TIMEOUT_MS },
  );
  if (res.timedOut) throw timeout('claude');
  let out: Record<string, unknown>;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    throw failure('claude', res);
  }
  if (out.is_error === true) {
    const detail = typeof out.result === 'string' ? `: ${out.result.slice(0, 300)}` : '';
    throw new JudgeError(`claude returned an error (${String(out.subtype ?? 'unknown')})${detail}`);
  }
  if (out.structured_output !== undefined) return out.structured_output;
  if (typeof out.result === 'string') return parseJsonText(out.result, 'claude');
  throw new JudgeError('claude returned no structured output');
}

async function runCodex(prompt: string, cwd: string, exec: Exec): Promise<unknown> {
  const schemaFile = join(cwd, 'schema.json');
  const outFile = join(cwd, 'last-message.txt');
  writeFileSync(schemaFile, JSON.stringify(JUDGE_JSON_SCHEMA));
  const res = await exec(
    'codex',
    [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--output-schema',
      schemaFile,
      '--output-last-message',
      outFile,
      '-',
    ],
    { input: prompt, cwd, timeoutMs: TIMEOUT_MS },
  );
  if (res.timedOut) throw timeout('codex');
  if (res.code !== 0) throw failure('codex', res);
  let text: string;
  try {
    text = readFileSync(outFile, 'utf8');
  } catch {
    throw new JudgeError('codex finished without writing a reply');
  }
  return parseJsonText(text, 'codex');
}

/** Accepts bare JSON or JSON wrapped in prose or a code fence. */
export function parseJsonText(text: string, cli: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  throw new JudgeError(`${cli} did not reply with JSON`);
}

function timeout(cli: string): JudgeError {
  return new JudgeError(`${cli} took longer than ${TIMEOUT_MS / 60_000} minutes`);
}

function failure(cli: string, res: ExecResult): JudgeError {
  const detail = (res.stderr || res.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 300);
  return new JudgeError(`${cli} exited with code ${res.code}${detail ? `: ${detail}` : ''}`);
}
