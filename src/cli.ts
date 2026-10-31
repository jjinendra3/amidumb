import { parseArgs } from 'node:util';
import { version } from '../package.json';
import { renderSurvey } from './report/survey';
import { renderAggregate, renderLeverage, renderSample, renderSessions } from './report/table';
import { type AggregateSignals, aggregate } from './signals/aggregate';
import { readLeverage } from './signals/leverage';
import { computeSessionSignals } from './signals/session';
import {
  type AgentTool,
  clipToWindow,
  defaultRoots,
  readAllSessions,
  type Session,
  type SourceRoots,
} from './sources';

const HELP = `amidumb: your AI coding transcripts, judged.

Usage
  amidumb [options]          raw signals for your Claude Code and Codex sessions
  amidumb survey [options]   record kinds and keys in your transcripts (no content)

Options
  --days <n|all>     window to read (default 30)
  --sessions         one row per session, with titles (stays local)
  --sample <n>       print n random detected prompts to check detection (stays local)
  --json             numbers only, no text, titles or paths: safe to share
  --claude-dir <p>   Claude Code transcripts (default ~/.claude/projects)
  --codex-dir <p>    Codex transcripts (default ~/.codex/sessions)
  -h, --help
  -v, --version

Nothing leaves your machine.`;

const TOOLS: readonly AgentTool[] = ['claude-code', 'codex'];

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      days: { type: 'string', default: '30' },
      raw: { type: 'boolean' },
      sessions: { type: 'boolean' },
      sample: { type: 'string' },
      json: { type: 'boolean' },
      'claude-dir': { type: 'string' },
      'codex-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.help) return void console.log(HELP);
  if (values.version) return void console.log(version);

  const since = parseSince(values.days);
  const defaults = defaultRoots();
  const roots: SourceRoots = {
    'claude-code': values['claude-dir'] ?? defaults['claude-code'],
    codex: values['codex-dir'] ?? defaults.codex,
  };

  if (positionals[0] === 'survey') return void console.log(await renderSurvey(roots, since));
  if (positionals.length > 0) throw new UsageError(`unknown command: ${positionals[0]}`);

  const started = Date.now();
  const all = await readAllSessions(roots, since);
  const sessions = all
    .filter((s) => s.origin === 'interactive')
    .map((s) => clipToWindow(s, since))
    .filter((s) => s.events.some((e) => e.kind === 'prompt'));
  const rows = sessions.map(computeSessionSignals);
  const leverage = readLeverage(sessions.flatMap((s) => (s.cwd ? [s.cwd] : [])));

  const columns: [string, AggregateSignals][] = TOOLS.filter((t) =>
    rows.some((r) => r.tool === t),
  ).map((t) => [t, aggregate(rows.filter((r) => r.tool === t))]);
  if (columns.length > 1) columns.push(['all', aggregate(rows)]);

  if (values.json) {
    const report = {
      schema: 1,
      version,
      generatedAt: new Date().toISOString(),
      windowDays: since === undefined ? 'all' : Number(values.days),
      leverage,
      aggregate: Object.fromEntries(columns),
      sessions: rows,
    };
    return void console.log(JSON.stringify(report, null, 2));
  }

  if (rows.length === 0) {
    console.log(`No sessions found in the last ${values.days} days under:`);
    for (const root of Object.values(roots)) console.log(`  ${root}`);
    return;
  }

  console.log(renderAggregate(columns));
  console.log(`\n${renderLeverage(leverage)}`);
  if (values.sessions) {
    console.log(
      `\n${renderSessions(sessions.map((s, i) => [s, rows[i]] as [Session, (typeof rows)[number]]))}`,
    );
  }
  if (values.sample) console.log(`\n${renderSample(sessions, parseCount(values.sample))}`);

  const skipped = countBy(
    all.filter((s) => s.origin !== 'interactive'),
    (s) => s.origin,
  );
  console.error(
    `\nread ${all.length} sessions in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      (Object.keys(skipped).length
        ? `; skipped ${Object.entries(skipped)
            .map(([k, n]) => `${n} ${k}`)
            .join(', ')}`
        : ''),
  );
  if (!values.raw)
    console.error('scoring is not built yet: these are the raw signals it will use.');
}

class UsageError extends Error {}

function parseSince(days: string | undefined): number | undefined {
  if (days === 'all') return undefined;
  return Date.now() - parseCount(days ?? '30') * 86_400_000;
}

function parseCount(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    throw new UsageError(`expected a positive integer, got "${value}"`);
  return n;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

main().catch((error: unknown) => {
  if (
    error instanceof UsageError ||
    (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
  ) {
    console.error(`amidumb: ${(error as Error).message}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
