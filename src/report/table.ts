import type { AggregateSignals } from '../signals/aggregate';
import type { Leverage } from '../signals/leverage';
import { redactSecrets } from '../signals/secrets';
import type { PromptFlag, SessionSignals } from '../signals/session';
import type { Session } from '../sources';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => String(Math.round(x * 10) / 10);

const FLAG_LABELS: Record<PromptFlag, string> = {
  pathOrSymbol: 'names a path or symbol',
  constraint: 'sets a constraint',
  acceptance: 'states acceptance criteria',
  verifyAsk: 'asks to test / review',
  correction: 'corrects the agent',
  approval: 'short approval ("yes", "go")',
  continue: 'bare "continue"',
  fixIt: '"fix it" / "still broken"',
  errorOnly: 'just a pasted error',
  rage: 'rage (swearing, CAPS, !!!)',
};

type Row = [label: string, value: (a: AggregateSignals) => string];

const ROWS: Row[] = [
  ['sessions', (a) => String(a.sessions)],
  ['prompts', (a) => String(a.prompts)],
  ['prompts per session (median)', (a) => num(a.promptsPerSession)],
  ['prompt length, median chars', (a) => num(a.promptCharsMedian)],
  ['prompt length, p90 chars', (a) => num(a.promptCharsP90)],
  ['active hours', (a) => num(a.activeHours)],
  ['', () => ''],
  ...(Object.keys(FLAG_LABELS) as PromptFlag[]).map(
    (k): Row => [`% prompts: ${FLAG_LABELS[k]}`, (a) => pct(a.flagRates[k])],
  ),
  ['% prompts: pasted content', (a) => pct(a.pastedRate)],
  ['', () => ''],
  ['interrupts per 100 prompts', (a) => num(a.interruptsPer100Prompts)],
  ['tool rejections per 100 prompts', (a) => num(a.rejectionsPer100Prompts)],
  ['% sessions using plan mode', (a) => pct(a.planSessionsRate)],
  ['% sessions running tests/lint', (a) => pct(a.verifySessionsRate)],
  ['longest fix-it streak (prompts)', (a) => String(a.longestFixStreak)],
  ['% prompts in auto mode', (a) => pct(a.permissionShare.auto ?? 0)],
  ['% prompts in bypass mode', (a) => pct(a.permissionShare.bypass ?? 0)],
  ['% prompts in default mode', (a) => pct(a.permissionShare.default ?? 0)],
  ['% prompts in accept-edits mode', (a) => pct(a.permissionShare['accept-edits'] ?? 0)],
  ['% prompts with mode not recorded', (a) => pct(a.permissionShare.unknown ?? 0)],
  ['', () => ''],
  ['slash commands', (a) => String(a.slashCommands)],
  ['compactions', (a) => String(a.compactions)],
  ['tool errors', (a) => String(a.toolErrors)],
  ['images', (a) => String(a.images)],
  ['secrets pasted into prompts', (a) => String(a.secrets)],
];

export function renderAggregate(columns: ReadonlyArray<[string, AggregateSignals]>): string {
  const labelWidth = Math.max(...ROWS.map(([label]) => label.length));
  const colWidth = Math.max(12, ...columns.map(([name]) => name.length + 2));
  const header = ''.padEnd(labelWidth) + columns.map(([name]) => name.padStart(colWidth)).join('');
  const lines = ROWS.map(([label, value]) =>
    label
      ? label.padEnd(labelWidth) + columns.map(([, a]) => value(a).padStart(colWidth)).join('')
      : '',
  );
  return [header, ...lines].join('\n');
}

export function renderLeverage(l: Leverage): string {
  const yes = (b: boolean) => (b ? 'yes' : 'no');
  return [
    'setup',
    `  global CLAUDE.md: ${yes(l.claudeGlobalInstructions)}   global Codex AGENTS.md: ${yes(l.codexGlobalInstructions)}`,
    `  claude skills: ${l.claudeSkills}   commands: ${l.claudeCommands}   hooks: ${yes(l.claudeHooks)}`,
    `  codex skills: ${l.codexSkills}   prompts: ${l.codexPrompts}   hooks: ${yes(l.codexHooks)}`,
    `  projects with CLAUDE.md/AGENTS.md: ${l.projectsWithInstructions}/${l.projectsChecked}` +
      (l.projectsMissing ? ` (${l.projectsMissing} no longer on disk)` : ''),
  ].join('\n');
}

/** Local only: includes session titles. */
export function renderSessions(pairs: ReadonlyArray<[Session, SessionSignals]>): string {
  const header = [
    'date',
    'tool',
    'client',
    'prompts',
    'path%',
    'fixit',
    'intr',
    'plan',
    'verify',
    'title',
  ];
  const rows = [...pairs]
    .sort(([a], [b]) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    .map(([s, r]) => [
      s.startedAt ? new Date(s.startedAt).toISOString().slice(0, 10) : '?',
      s.tool,
      s.client,
      String(r.prompts),
      pct(r.prompts ? r.flags.pathOrSymbol / r.prompts : 0),
      String(r.flags.fixIt + r.flags.errorOnly),
      String(r.interrupts),
      r.planUsed ? 'y' : '',
      String(r.verifyCommands),
      (s.title ?? s.cwd?.split('/').pop() ?? '').slice(0, 50),
    ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const fmt = (row: string[]) =>
    row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  ');
  return [fmt(header), ...rows.map(fmt)].join('\n');
}

/** Local only: random detected prompts, so detection can be eyeballed. */
export function renderSample(sessions: readonly Session[], n: number): string {
  const prompts = sessions.flatMap((s) =>
    s.events.flatMap((e) => (e.kind === 'prompt' ? [[s.tool, e.text] as const] : [])),
  );
  return prompts
    .map((prompt) => ({ prompt, key: Math.random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, n)
    .map(({ prompt: [tool, text] }) => {
      const oneLine = redactSecrets(text).text.replace(/\s+/g, ' ').trim();
      return `[${tool}] ${oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine}`;
    })
    .join('\n');
}
