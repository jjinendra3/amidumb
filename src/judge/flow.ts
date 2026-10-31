import { buildJudgePrompt, estimateTokens, type JudgeContext } from './prompt';
import { detectJudge, type Exec, type JudgeCli, runJudge, runProcess } from './run';
import type { Sample } from './sample';
import { resolveJudgeOutput, type Verdict } from './schema';

/** Fewer prompts than this and there's nothing worth roasting. */
export const MIN_SAMPLE = 10;

export interface RoastOptions {
  sample: Sample;
  context: JudgeContext;
  /** Print the exact judge prompt and send nothing. */
  dryRun: boolean;
  /** Skip the confirmation question. */
  yes: boolean;
  /** Whether a human can answer the confirmation question. */
  interactive: boolean;
  /** Force a CLI instead of the first one on PATH. */
  judge?: JudgeCli;
  confirm: (question: string) => Promise<boolean>;
  /** Machine-readable output (the dry-run prompt). */
  print: (text: string) => void;
  /** Progress and notices. */
  info: (text: string) => void;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
}

export type RoastResult =
  | { status: 'dry-run' }
  | { status: 'skipped'; reason: string }
  | { status: 'done'; cli: JudgeCli; verdict: Verdict };

/** Nothing is sent unless this returns `done`. Judge failures throw `JudgeError`. */
export async function roast(o: RoastOptions): Promise<RoastResult> {
  if (o.sample.items.length < MIN_SAMPLE) {
    return { status: 'skipped', reason: `only ${o.sample.items.length} prompts to judge` };
  }
  const prompt = buildJudgePrompt(o.context, o.sample);
  const what = `${o.sample.items.length} redacted prompts from ${o.sample.sessions} sessions (~${Math.round(estimateTokens(prompt) / 1000)}k tokens)`;

  if (o.dryRun) {
    o.print(prompt);
    o.info(
      `\n--dry-run: the above is everything the roast would send (${what}). Nothing was sent.`,
    );
    return { status: 'dry-run' };
  }

  const cli = o.judge ?? detectJudge(o.env);
  if (!cli) return { status: 'skipped', reason: 'no claude or codex CLI on your PATH' };

  if (!o.yes) {
    if (!o.interactive) {
      return {
        status: 'skipped',
        reason: `not a terminal. Rerun with --yes to send ${what} to your ${cli} CLI`,
      };
    }
    const ok = await o.confirm(
      `\nSend ${what} to your ${cli} CLI for the roast? It runs on your own plan. [Y/n] `,
    );
    if (!ok) return { status: 'skipped', reason: 'you said no' };
  }

  o.info(`judging with ${cli}, this takes a minute…`);
  const raw = await runJudge(cli, prompt, o.exec ?? runProcess);
  return { status: 'done', cli, verdict: resolveJudgeOutput(raw, o.sample) };
}
