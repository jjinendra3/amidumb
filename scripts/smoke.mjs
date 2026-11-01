// End-to-end smoke test of the built CLI, runnable on Node 18+ on any OS:
//   node scripts/smoke.mjs [path/to/cli.js]
// Writes synthetic transcripts, puts fake `claude` and `codex` CLIs on PATH (as .cmd shims
// on Windows, the way npm installs them), runs amidumb against them and checks the card,
// the image, and that every argument reached the judge intact. No network, no tokens.

import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(process.argv[2] ?? join(root, 'dist', 'cli.js'));
const work = mkdtempSync(join(tmpdir(), 'amidumb-smoke-'));
const windows = process.platform === 'win32';

// Synthetic Claude Code transcripts: 8 sessions, 8 prompts each.
const projects = join(work, 'claude-projects');
const codexSessions = join(work, 'codex-sessions');
mkdirSync(join(projects, '-tmp-app'), { recursive: true });
mkdirSync(codexSessions, { recursive: true });
const PROMPTS = [
  'Add a retry to fetchUser in src/api/user.ts, only on 5xx, keep the signature.',
  'yes',
  'no, use the existing backoff helper instead',
  'run the tests and show me the diff',
  'fix it',
  'continue',
  'why does the cart total flicker?',
  'Move the constant to src/lib/retry.ts and export it, nothing else.',
];
for (let s = 0; s < 8; s++) {
  const sessionId = `smoke-${s}`;
  const base = { sessionId, cwd: '/tmp/app', entrypoint: 'cli', isSidechain: false };
  const lines = PROMPTS.flatMap((text, i) => {
    const timestamp = new Date(Date.UTC(2026, 9, 1 + s, 10, i)).toISOString();
    const tool = i % 2
      ? { type: 'tool_use', id: `t${i}`, name: 'Edit', input: { file_path: 'src/api/user.ts' } }
      : { type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: 'pnpm test' } };
    return [
      { ...base, type: 'user', timestamp, origin: { kind: 'human' }, message: { role: 'user', content: text } },
      {
        ...base,
        type: 'assistant',
        timestamp,
        message: { role: 'assistant', content: [{ type: 'text', text: i === 0 ? 'Plan: wrap it. Should I proceed?' : 'Done.' }, tool] },
      },
    ];
  });
  writeFileSync(join(projects, '-tmp-app', `${sessionId}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

// A fake judge that checks what it was given, then replies like the real CLI.
const bin = join(work, 'bin');
mkdirSync(bin);
writeFileSync(
  join(bin, 'fake-judge.mjs'),
  `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const [cli, ...args] = process.argv.slice(2);
if (args.join(' ') === (cli === 'claude' ? 'auth status' : 'login status')) {
  const out = process.env.FAKE_JUDGE_LOGGED_OUT === '1';
  process.stdout.write(cli === 'claude' ? JSON.stringify({ loggedIn: !out }) : out ? 'Not logged in' : 'Logged in using ChatGPT');
  process.exit(out ? 1 : 0);
}
const bad = args.find((a) => (process.env.FAKE_JUDGE_REJECT || '').split(',').includes(a));
if (bad) {
  process.stderr.write(cli === 'claude' ? "error: unknown option '" + bad + "'\\n" : "error: unexpected argument '" + bad + "' found\\n");
  process.exit(cli === 'claude' ? 1 : 2);
}
const input = readFileSync(0, 'utf8');
const problems = [];
if (!input.includes('SAMPLE:')) problems.push('prompt did not arrive on stdin');
const value = (flag) => args[args.indexOf(flag) + 1];
if (cli === 'claude') {
  if (value('-p') !== 'Follow the instructions in the input and reply with the JSON only.') problems.push('-p arrived mangled: ' + value('-p'));
  if (args.includes('--json-schema')) {
    try { if (!JSON.parse(value('--json-schema')).properties.points) problems.push('schema lost its fields'); }
    catch { problems.push('--json-schema arrived mangled: ' + value('--json-schema')); }
  } else if (!input.includes('JSON Schema')) problems.push('no schema flag and no schema in the prompt');
}
if (cli === 'codex' && !args.includes('--output-schema') && !input.includes('JSON Schema')) problems.push('no schema flag and no schema in the prompt');
appendFileSync(process.env.FAKE_JUDGE_LOG, JSON.stringify({ cli, args, problems }) + '\\n');
if (problems.length) { process.stderr.write(problems.join('; ')); process.exit(3); }
const reply = {
  verdict: 'Smoke judge verdict.',
  points: [
    { text: 'Smoke point one.', evidence: ['p1'] },
    { text: 'Smoke point two.', evidence: ['p2'] },
    { text: 'Invented point.', evidence: ['p99999'] },
  ],
  habits: ['one', 'two', 'three'],
};
if (cli === 'claude') {
  const structured = args.includes('--json-schema');
  process.stdout.write(JSON.stringify({ is_error: false, structured_output: structured ? reply : undefined, result: structured ? '' : 'Here: ' + JSON.stringify(reply) }));
} else {
  writeFileSync(value('--output-last-message'), JSON.stringify(reply));
}
`,
);
for (const name of ['claude', 'codex']) {
  if (windows) {
    writeFileSync(join(bin, `${name}.cmd`), `@node "%~dp0fake-judge.mjs" ${name} %*\r\n`);
  } else {
    writeFileSync(join(bin, name), `#!/bin/sh\nexec node "$(dirname "$0")/fake-judge.mjs" ${name} "$@"\n`);
    chmodSync(join(bin, name), 0o755);
  }
}

const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const SCENARIOS = [
  { name: 'claude, found on PATH', args: [], reject: '' },
  { name: 'claude, older CLI', args: [], reject: '--safe-mode,--no-session-persistence,--json-schema' },
  { name: 'codex', args: ['--codex'], reject: '' },
  { name: 'codex, older CLI', args: ['--codex'], reject: '--ephemeral,--output-schema,--color' },
  { name: 'claude, logged out', args: [], reject: '', loggedOut: true },
];

let failed = 0;
for (const scenario of SCENARIOS) {
  const cwd = mkdtempSync(join(work, 'run-'));
  const log = join(cwd, 'judge.log');
  appendFileSync(log, '');
  const run = spawnSync(
    process.execPath,
    [cli, '--no-open', '--claude-dir', projects, '--codex-dir', codexSessions, ...scenario.args],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, [pathKey]: bin + delimiter + process.env[pathKey], FAKE_JUDGE_REJECT: scenario.reject, FAKE_JUDGE_LOG: log, FAKE_JUDGE_LOGGED_OUT: scenario.loggedOut ? '1' : '' },
    },
  );
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const png = readdirSync(cwd).find((f) => /^amidumb-\d{4}-\d\d-\d\d\.png$/.test(f));
  const image = png ? readFileSync(join(cwd, png)) : undefined;
  const savedPng = Boolean(image && image.subarray(1, 4).toString() === 'PNG' && image.readUInt32BE(16) === 1080 && image.readUInt32BE(20) === 1350);
  const checks = scenario.loggedOut ? [
    ['exits 0', run.status === 0],
    ['says the CLI is logged out', /your claude CLI isn't logged in/.test(run.stderr)],
    ['sends nothing', calls.length === 0 && !/sending/.test(run.stderr)],
    ['saves a 1080x1350 PNG', savedPng],
  ] : [
    ['exits 0', run.status === 0],
    ['says what it sends', /sending \d+ redacted prompts .* to your (claude|codex) CLI/.test(run.stderr)],
    ['judge got intact args', calls.length > 0 && calls.every((c) => c.problems.length === 0)],
    ['shows the verdict', run.stdout.includes('Smoke judge verdict.')],
    ['keeps grounded points', run.stdout.includes('Smoke point one.') && run.stdout.includes('Smoke point two.')],
    ['drops the invented point', !run.stdout.includes('Invented point.')],
    ['saves a 1080x1350 PNG', savedPng],
  ];
  const bad = checks.filter(([, ok]) => !ok);
  console.log(`${bad.length ? '✗' : '✓'} ${scenario.name}${bad.length ? `: ${bad.map(([n]) => n).join(', ')}` : ''}`);
  if (bad.length) {
    failed++;
    console.log(`  exit ${run.status}\n  stderr: ${run.stderr.trim().slice(-800)}\n  stdout: ${run.stdout.trim().slice(-400)}`);
    for (const c of calls) console.log(`  judge call: ${c.cli} ${c.args.join(' ').slice(0, 300)} ${c.problems.join('; ')}`);
  }
}

if (!existsSync(cli)) console.log(`(no CLI at ${cli}: run pnpm build first)`);
console.log(failed ? `\n${failed} of ${SCENARIOS.length} scenarios failed` : `\nall ${SCENARIOS.length} scenarios passed on ${process.platform}, Node ${process.versions.node}`);
process.exit(failed ? 1 : 0);
