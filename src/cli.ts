import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { version } from '../package.json';
import { JUDGING_CAPTIONS } from './judge/captions';
import { roast } from './judge/flow';
import { JUDGE_CLIS, type JudgeCli } from './judge/run';
import { buildSample } from './judge/sample';
import { JudgeError, type Verdict } from './judge/schema';
import { labelsPath, loadLabels } from './label/store';
import { runLabeling } from './label/ui';
import { load, loadForScoring } from './pipeline';
import { calibrate, renderCalibration } from './report/calibrate';
import { type CardInput, renderCard } from './report/card';
import { renderCardPng } from './report/image';
import { openFile } from './report/open';
import { describeWindow, renderScore, type WindowInfo } from './report/score';
import { withSpinner } from './report/spinner';
import { renderSurvey } from './report/survey';
import { renderAggregate, renderLeverage, renderSample, renderSessions } from './report/table';
import { MIN_PROMPTS, MIN_SESSIONS, scoreSession, scoreUser, type UserScore } from './score/rubric';
import { type AggregateSignals, aggregate } from './signals/aggregate';
import { type SessionSignals, sessionHash } from './signals/session';
import { type AgentTool, defaultRoots, type Session, type SourceRoots } from './sources';

const HELP = `amidumb: your AI coding transcripts, judged.

Usage
  amidumb [options]            your direction score, from Claude Code and Codex sessions
  amidumb label [options]      label your own sessions (blind) to sanity-check the rubric
  amidumb calibrate            how well the rubric ranks your labelled sessions
  amidumb survey [options]     record kinds and keys in your transcripts (no content)

Options
  --days <n|all>     window to read (default: all history on disk)
  --raw              the full table of raw signals instead of the score
  --sessions         one row per session, with titles (stays local)
  --sample <n>       print n random detected prompts to check detection (stays local)
  --json             numbers only, no text, titles or paths: safe to share
  --no-roast         score and card only, nothing is sent anywhere
  --dry-run          print exactly what the roast would send, and send nothing
  --judge <cli>      claude or codex (default: the first one installed)
  --no-open          save the card image without opening it
  --limit <n>        label: sessions per run (default 40)
  --relabel          label: include sessions you already labelled
  --claude-dir <p>   Claude Code transcripts (default ~/.claude/projects)
  --codex-dir <p>    Codex transcripts (default ~/.codex/sessions)
  -h, --help
  -v, --version

The score is computed locally. The roast sends a redacted sample of about 150 of
your prompts to your own claude or codex CLI (--no-roast skips it). No telemetry.`;

const TOOLS: readonly AgentTool[] = ['claude-code', 'codex'];

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      days: { type: 'string' },
      raw: { type: 'boolean' },
      sessions: { type: 'boolean' },
      sample: { type: 'string' },
      json: { type: 'boolean' },
      limit: { type: 'string' },
      relabel: { type: 'boolean' },
      'no-roast': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      judge: { type: 'string' },
      'no-open': { type: 'boolean' },
      'claude-dir': { type: 'string' },
      'codex-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.help) return void console.log(HELP);
  if (values.version) return void console.log(version);

  const days = parseDays(values.days);
  const defaults = defaultRoots();
  const roots: SourceRoots = {
    'claude-code': values['claude-dir'] ?? defaults['claude-code'],
    codex: values['codex-dir'] ?? defaults.codex,
  };

  const [command, ...rest] = positionals;
  if (rest.length > 0) throw new UsageError(`unexpected argument: ${rest[0]}`);
  switch (command) {
    case undefined:
      return report(roots, days, values);
    case 'survey': {
      const since = typeof days === 'number' ? Date.now() - days * 86_400_000 : undefined;
      return void console.log(await renderSurvey(roots, since));
    }
    case 'label':
      return label(roots, days, parseCount(values.limit ?? '40'), Boolean(values.relabel));
    case 'calibrate':
      return calibration(roots);
    default:
      throw new UsageError(`unknown command: ${command}`);
  }
}

async function report(
  roots: SourceRoots,
  days: number | 'all' | undefined,
  values: {
    raw?: boolean;
    json?: boolean;
    sessions?: boolean;
    sample?: string;
    'no-roast'?: boolean;
    'dry-run'?: boolean;
    judge?: string;
    'no-open'?: boolean;
  },
): Promise<void> {
  const judge = parseJudge(values.judge);
  const debug = Boolean(values.raw || values.sessions || values.sample);
  // The plain run is the show: nothing printed until the reveal.
  const show = !values.json && !debug;
  const started = Date.now();
  const loading = loadForScoring(roots, days);
  const { all, sessions, rows, leverage, window } = await (show
    ? withSpinner(loading, { captions: ['reading your transcripts'] })
    : loading);
  const score = scoreUser(rows, leverage);

  const columns: [string, AggregateSignals][] = TOOLS.filter((t) =>
    rows.some((r) => r.tool === t),
  ).map((t) => [t, aggregate(rows.filter((r) => r.tool === t))]);
  if (columns.length > 1) columns.push(['all', aggregate(rows)]);

  if (values.json) {
    const json = {
      schema: 2,
      version,
      generatedAt: new Date().toISOString(),
      window,
      score: score ?? null,
      leverage,
      aggregate: Object.fromEntries(columns),
      sessions: rows,
    };
    return void console.log(JSON.stringify(json, null, 2));
  }

  if (rows.length === 0) {
    console.log('No sessions found under:');
    for (const root of Object.values(roots)) console.log(`  ${root}`);
    return;
  }

  if (score && show) return reveal(sessions, rows, score, window, judge, values);

  if (values.raw) {
    console.log(renderAggregate(columns));
  } else if (score) {
    console.log(renderScore(score, window));
  } else {
    console.log(
      `Not enough data to score: need ${MIN_SESSIONS} sessions with 2+ prompts and ${MIN_PROMPTS} prompts.\n` +
        `Found ${describeWindow(window)}. Raw signals:\n`,
    );
    console.log(renderAggregate(columns));
  }
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
}

async function reveal(
  sessions: Session[],
  rows: SessionSignals[],
  score: UserScore,
  window: WindowInfo,
  judge: JudgeCli | undefined,
  values: { 'no-roast'?: boolean; 'dry-run'?: boolean; 'no-open'?: boolean },
): Promise<void> {
  const ragePrompts = rows.reduce((n, r) => n + r.flags.rage, 0);
  const secrets = rows.reduce((n, r) => n + r.secrets, 0);
  let verdict: Verdict | undefined;
  if (!values['no-roast']) {
    try {
      const result = await roast({
        sample: buildSample(sessions),
        context: { score, window, ragePrompts, secrets },
        dryRun: Boolean(values['dry-run']),
        judge,
        print: (text) => console.log(text),
        info: (text) => console.error(text),
        during: (task) => withSpinner(task, { captions: JUDGING_CAPTIONS }),
      });
      if (result.status === 'dry-run') return;
      if (result.status === 'skipped') console.error(`no roast: ${result.reason}.`);
      else verdict = result.verdict;
    } catch (error) {
      if (!(error instanceof JudgeError)) throw error;
      console.error(
        `roast failed: ${error.message}\nHere's your score anyway; rerun for the roast.`,
      );
      process.exitCode = 1;
    }
  }

  const card: CardInput = { score, window, verdict, ragePrompts, secrets };
  console.log(`\n${renderCard({ ...card, columns: process.stdout.columns })}`);
  await saveImage(card, !values['no-open']);
}

/** Saves the shareable PNG next to where amidumb was run, and opens it. */
async function saveImage(card: CardInput, open: boolean): Promise<void> {
  const d = new Date();
  const date = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
  const file = `amidumb-${date}.png`;
  const path = join(process.cwd(), file);
  try {
    writeFileSync(path, await renderCardPng(card));
  } catch (error) {
    console.error(`couldn't make the card image: ${(error as Error).message}`);
    return;
  }
  console.log(`\ncard saved to ./${file}`);
  if (open && process.stdout.isTTY) openFile(path);
}

function parseJudge(value: string | undefined): JudgeCli | undefined {
  if (value === undefined) return undefined;
  if ((JUDGE_CLIS as readonly string[]).includes(value)) return value as JudgeCli;
  throw new UsageError(`--judge must be one of: ${JUDGE_CLIS.join(', ')}`);
}

async function label(
  roots: SourceRoots,
  days: number | 'all' | undefined,
  limit: number,
  relabel: boolean,
): Promise<void> {
  if (!process.stdin.isTTY) throw new UsageError('label needs an interactive terminal');
  const path = labelsPath();
  const store = loadLabels(path);
  const { sessions } = await loadForScoring(roots, days);
  const candidates = sessions
    .filter((s) => s.events.filter((e) => e.kind === 'prompt').length >= 2)
    .filter((s) => relabel || !store.labels[sessionHash(s)])
    .map((s) => ({ s, key: Math.random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, limit)
    .map(({ s }) => s);
  if (candidates.length === 0) {
    console.log('Nothing left to label in this window. Try --days all or --relabel.');
    return;
  }
  const labelled = await runLabeling(candidates, store, path);
  console.log(
    `\nLabelled ${labelled} sessions (${Object.keys(store.labels).length} in total), saved to ${path}.`,
  );
  console.log('Run `amidumb calibrate` to see how the rubric ranks them.');
}

async function calibration(roots: SourceRoots): Promise<void> {
  const store = loadLabels(labelsPath());
  const labelled = Object.keys(store.labels).length;
  if (labelled === 0) {
    console.log('No labels yet. Run `amidumb label` first.');
    return;
  }
  const { rows } = await load(roots, 'all');
  const scores = new Map(rows.map((r) => [r.id, scoreSession(r)]));
  const matched = Object.keys(store.labels).filter((id) => scores.has(id)).length;
  console.log(renderCalibration(calibrate(store.labels, scores), labelled, matched));
}

class UsageError extends Error {}

function parseDays(days: string | undefined): number | 'all' | undefined {
  if (days === undefined || days === 'all') return days;
  return parseCount(days);
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
