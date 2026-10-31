import { emitKeypressEvents } from 'node:readline';
import { redactSecrets } from '../signals/secrets';
import { computeSessionSignals, sessionHash } from '../signals/session';
import type { Session } from '../sources';
import { CONTROL_KEYS, LABEL_FIELDS, type SessionLabel } from './fields';
import { type LabelStore, saveLabels } from './store';

const PROMPT_CHARS = 300;
const AGENT_CHARS = 160;
const COMMAND_CHARS = 60;
const MAX_TURNS = 30;

const oneLine = (text: string, max: number) => {
  const t = redactSecrets(text).text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Blind view of a session: what you and the agent said and which tools ran. No scores or
 * derived signals, so labels can't be nudged by what the rubric already thinks.
 */
export function renderSessionForLabel(
  session: Session,
  position: { index: number; total: number },
): string {
  const { prompts, activeMinutes } = computeSessionSignals(session);
  const date = session.startedAt ? new Date(session.startedAt).toISOString().slice(0, 10) : '?';
  const lines = [
    `[${position.index + 1}/${position.total}] ${date} · ${session.tool} · ${session.client} · ${prompts} prompts · ${activeMinutes} min`,
    session.title ?? session.cwd?.split('/').pop() ?? '',
    '',
  ];

  let agentText: string | undefined;
  let tools: string[] = [];
  let interrupted = false;
  let shown = 0;
  const flushTurn = () => {
    if (tools.length) lines.push(`         ${summarizeTools(tools)}`);
    if (agentText) lines.push(`  agent  ${oneLine(agentText, AGENT_CHARS)}`);
    if (interrupted) lines.push('         (you interrupted)');
  };

  for (const event of session.events) {
    if (event.kind === 'assistant_text') agentText = event.text;
    else if (event.kind === 'tool_call')
      tools.push(event.command ? `$ ${oneLine(event.command, COMMAND_CHARS)}` : event.name);
    else if (event.kind === 'interrupt') interrupted = true;
    else if (event.kind === 'prompt') {
      if (shown === MAX_TURNS) break;
      flushTurn();
      lines.push(`  you    ${oneLine(event.text, PROMPT_CHARS)}`);
      shown++;
      agentText = undefined;
      tools = [];
      interrupted = false;
    }
  }
  if (shown < prompts) lines.push(`  … ${prompts - shown} more prompts`);
  else flushTurn();
  return lines.join('\n');
}

/** "Edit×3, Read, $ pnpm test" with shell commands kept verbatim (max 3). */
function summarizeTools(tools: readonly string[]): string {
  const counts = new Map<string, number>();
  const commands: string[] = [];
  for (const t of tools) {
    if (t.startsWith('$ ')) commands.push(t);
    else counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const named = [...counts].map(([name, n]) => (n > 1 ? `${name}×${n}` : name));
  const shownCommands = commands.slice(0, 3);
  const more = commands.length > 3 ? [`+${commands.length - 3} commands`] : [];
  return `[${[...named, ...shownCommands, ...more].join(', ')}]`;
}

interface Key {
  name?: string;
  ctrl?: boolean;
}

function readKey(): Promise<Key> {
  return new Promise((resolve) =>
    process.stdin.once('keypress', (_s, key: Key) => resolve(key ?? {})),
  );
}

/** Interactive loop. Saves after every session; returns how many were labelled. */
export async function runLabeling(
  sessions: readonly Session[],
  store: LabelStore,
  path: string,
): Promise<number> {
  const out = process.stdout;
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let labelled = 0;

  try {
    for (const [index, session] of sessions.entries()) {
      out.write('\x1b[2J\x1b[H');
      out.write(`${renderSessionForLabel(session, { index, total: sessions.length })}\n\n`);
      out.write(
        `keys: option letter · backspace = previous question · ${CONTROL_KEYS.skip} = skip session · ${CONTROL_KEYS.quit} = save and quit\n`,
      );

      const answers: Record<string, string> = {};
      let field = 0;
      let action: 'done' | 'skip' | 'quit' = 'done';
      while (field < LABEL_FIELDS.length) {
        const f = LABEL_FIELDS[field];
        if (!f) break;
        out.write(
          `\n${f.question}\n${f.options.map((o) => `  [${o.key}] ${o.value.padEnd(14)} ${o.help}`).join('\n')}\n> `,
        );
        const key = await readKey();
        if (key.ctrl && key.name === 'c') action = 'quit';
        else if (key.name === CONTROL_KEYS.quit) action = 'quit';
        else if (key.name === CONTROL_KEYS.skip) action = 'skip';
        if (action !== 'done') break;
        if (key.name === 'backspace') {
          field = Math.max(0, field - 1);
          out.write('(back)\n');
          continue;
        }
        const option = f.options.find((o) => o.key === key.name);
        if (!option) {
          out.write('(not an option)\n');
          continue;
        }
        answers[f.key] = option.value;
        out.write(`${option.value}\n`);
        field++;
      }

      if (action === 'quit') break;
      if (action === 'skip') continue;
      store.labels[sessionHash(session)] = {
        ...answers,
        labelledAt: new Date().toISOString(),
      } as SessionLabel;
      saveLabels(path, store);
      labelled++;
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  return labelled;
}
