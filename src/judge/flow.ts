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
  /** Force a CLI instead of the first one on PATH. */
  judge?: JudgeCli;
  /** Machine-readable output (the dry-run prompt). */
  print: (text: string) => void;
  /** Progress and notices. */
  info: (text: string) => void;
  /** Wraps the judge call, e.g. with a spinner. */
  during?: <T>(task: Promise<T>) => Promise<T>;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
}

export type RoastResult =
  | { status: 'dry-run' }
  | { status: 'skipped'; reason: string }
  | { status: 'done'; cli: JudgeCli; verdict: Verdict };

/**
 * Running `amidumb` is the consent: no question, but it says what goes where before
 * sending, and `--no-roast` / `--dry-run` exist. Judge failures throw `JudgeError`.
 */
export async function roast(o: RoastOptions): Promise<RoastResult> {
  if (o.sample.items.length < MIN_SAMPLE) {
    return { status: 'skipped', reason: `only ${o.sample.items.length} prompts to judge` };
  }
  const prompt = buildJudgePrompt(o.context, o.sample);
  const what = `${o.sample.items.length} redacted prompts from ${o.sample.sessions} sessions`;
  const tokens = `~${Math.round(estimateTokens(prompt) / 1000)}k tokens`;

  if (o.dryRun) {
    o.print(prompt);
    o.info(
      `\n--dry-run: the above is everything the roast would send (${what}, ${tokens}). Nothing was sent.`,
    );
    return { status: 'dry-run' };
  }

  const cli = o.judge ?? detectJudge(o.env);
  if (!cli) return { status: 'skipped', reason: 'no claude or codex CLI on your PATH' };

  o.info(`sending ${what} to your ${cli} CLI (${tokens} of your own plan) · --no-roast skips this`);
  const task = runJudge(cli, prompt, o.exec ?? runProcess);
  const raw = await (o.during ? o.during(task) : task);
  return { status: 'done', cli, verdict: resolveJudgeOutput(raw, o.sample) };
}
