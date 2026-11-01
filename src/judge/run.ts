import { accessSync, constants, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import crossSpawn from 'cross-spawn';
import { JUDGE_JSON_SCHEMA, JudgeError } from './schema';

// Runs the judge on the user's own CLI and plan: no API keys, no network calls of ours.
// Both runs are ephemeral where the CLI supports it, so the judge never shows up in the
// transcripts it judges.

export const JUDGE_CLIS = ['claude', 'codex'] as const;
export type JudgeCli = (typeof JUDGE_CLIS)[number];

const TIMEOUT_MS = 5 * 60_000;
const CLAUDE_BRIEF = 'Follow the instructions in the input and reply with the JSON only.';
/** The judge only reads the prompt; it gets no tools. */
const CLAUDE_DENIED_TOOLS =
  'Bash Edit Write Read Glob Grep WebFetch WebSearch Task Agent NotebookEdit TodoWrite';
const LOGIN_CHECK: Record<JudgeCli, readonly string[]> = {
  claude: ['auth', 'status'],
  codex: ['login', 'status'],
};
const LOGIN_TIMEOUT_MS = 10_000;
const UPDATE_HINT: Record<JudgeCli, string> = {
  claude: 'run `claude update`',
  codex: 'update it the way you installed it, e.g. `npm i -g @openai/codex@latest`',
};

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

/**
 * cross-spawn, not child_process.spawn: on Windows, npm installs both CLIs as `.cmd`
 * shims, which spawn can't run without a shell, and a shell would mangle the JSON args.
 */
export const runProcess: Exec = (cmd, args, { input, cwd, timeoutMs }) =>
  new Promise((resolve) => {
    const child = crossSpawn(cmd, [...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout?.on('data', (d) => {
      stdout += d;
    });
    child.stderr?.on('data', (d) => {
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
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });

/** The first judge CLI on PATH, Claude Code first. */
export function detectJudge(env: NodeJS.ProcessEnv = process.env): JudgeCli | undefined {
  return JUDGE_CLIS.find((cli) => onPath(cli, env));
}

export function onPath(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    for (const ext of exts) {
      try {
        accessSync(join(dir, name + ext), constants.X_OK);
        return true;
      } catch {}
    }
  }
  return false;
}

/**
 * True only when the CLI says it isn't logged in. Anything else (an older CLI without the
 * status command, a timeout, a key or provider the status command doesn't know about) lets
 * the judge run and fail with the CLI's own message, rather than blocking a setup that works.
 */
export async function loggedOut(
  cli: JudgeCli,
  exec: Exec = runProcess,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  // `codex login status` says "Not logged in" even when `codex exec` would run on an
  // API key from the environment or a model provider set in config.toml.
  if (cli === 'codex' && (env.CODEX_API_KEY || env.OPENAI_API_KEY || codexHasProvider(env))) {
    return false;
  }
  const res = await exec(cli, LOGIN_CHECK[cli], {
    input: '',
    cwd: tmpdir(),
    timeoutMs: LOGIN_TIMEOUT_MS,
  });
  if (res.timedOut || res.code === 0 || res.code === null) return false;
  return /"loggedIn"\s*:\s*false|not logged in/i.test(`${res.stdout}\n${res.stderr}`);
}

function codexHasProvider(env: NodeJS.ProcessEnv): boolean {
  const home = env.CODEX_HOME ?? join(homedir(), '.codex');
  try {
    return /^\s*model_provider\s*=/m.test(readFileSync(join(home, 'config.toml'), 'utf8'));
  } catch {
    return false;
  }
}

/**
 * A command-line flag. Optional flags are dropped one by one when an older CLI says it
 * doesn't know them; a required one it doesn't know means the CLI is too old.
 */
interface Flag {
  name: string;
  value?: string;
  required?: boolean;
  /** Dropping this flag loses structured output: the schema goes into the prompt instead. */
  schema?: boolean;
}

const UNKNOWN_FLAG = /(?:unknown option|unexpected argument|unrecognized option)\s*'?(--?[\w-]+)/i;

export function unknownFlag(output: string): string | undefined {
  return UNKNOWN_FLAG.exec(output)?.[1];
}

const SCHEMA_IN_PROMPT = `\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(JUDGE_JSON_SCHEMA)}`;

/** Runs `cmd` with `flags`, dropping optional flags the CLI doesn't know and retrying. */
async function runWithFallback(
  cli: JudgeCli,
  lead: readonly string[],
  flags: readonly Flag[],
  trail: readonly string[],
  prompt: string,
  cwd: string,
  exec: Exec,
): Promise<{ res: ExecResult; schemaInPrompt: boolean }> {
  let active = [...flags];
  for (;;) {
    const schemaInPrompt = flags.some((f) => f.schema && !active.includes(f));
    const args = [
      ...lead,
      ...active.flatMap((f) => (f.value === undefined ? [f.name] : [f.name, f.value])),
      ...trail,
    ];
    const res = await exec(cli, args, {
      input: schemaInPrompt ? prompt + SCHEMA_IN_PROMPT : prompt,
      cwd,
      timeoutMs: TIMEOUT_MS,
    });
    if (res.timedOut)
      throw new JudgeError(`${cli} took longer than ${TIMEOUT_MS / 60_000} minutes`);
    const unknown = res.code === 0 ? undefined : unknownFlag(`${res.stderr}\n${res.stdout}`);
    if (!unknown) return { res, schemaInPrompt };
    const flag = active.find((f) => f.name === unknown);
    if (!flag || flag.required) {
      throw new JudgeError(
        `your ${cli} CLI is too old for amidumb (it doesn't know ${unknown}); ${UPDATE_HINT[cli]}`,
      );
    }
    active = active.filter((f) => f !== flag);
  }
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
  const { res } = await runWithFallback(
    'claude',
    ['-p', CLAUDE_BRIEF],
    [
      { name: '--output-format', value: 'json', required: true },
      { name: '--safe-mode' },
      { name: '--no-session-persistence' },
      { name: '--json-schema', value: JSON.stringify(JUDGE_JSON_SCHEMA), schema: true },
      { name: '--disallowedTools', value: CLAUDE_DENIED_TOOLS },
    ],
    [],
    prompt,
    cwd,
    exec,
  );
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
  if (out.structured_output !== undefined && out.structured_output !== null) {
    return out.structured_output;
  }
  if (typeof out.result === 'string') return parseJsonText(out.result, 'claude');
  throw new JudgeError('claude returned no structured output');
}

async function runCodex(prompt: string, cwd: string, exec: Exec): Promise<unknown> {
  const schemaFile = join(cwd, 'schema.json');
  const outFile = join(cwd, 'last-message.txt');
  writeFileSync(schemaFile, JSON.stringify(JUDGE_JSON_SCHEMA));
  const { res } = await runWithFallback(
    'codex',
    ['exec'],
    [
      { name: '--skip-git-repo-check', required: true },
      { name: '--output-last-message', value: outFile, required: true },
      { name: '--ephemeral' },
      { name: '--sandbox', value: 'read-only' },
      { name: '--color', value: 'never' },
      { name: '--output-schema', value: schemaFile, schema: true },
    ],
    ['-'],
    prompt,
    cwd,
    exec,
  );
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

function failure(cli: string, res: ExecResult): JudgeError {
  const detail = (res.stderr || res.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 300);
  return new JudgeError(`${cli} exited with code ${res.code}${detail ? `: ${detail}` : ''}`);
}
