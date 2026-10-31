# amidumb

**Your AI coding transcripts, judged.** Do you direct your coding agent like an engineer, or do you just vibecode?

```sh
npx amidumb
```

amidumb reads your Claude Code and Codex transcripts, scores how you direct the agent from 0 to 100, gives you an archetype, gets your own agent to roast you for it, and saves the result as an image in the folder you ran it from, ready to post.

<!-- demo card: add a real amidumb-YYYY-MM-DD.png here -->

## What you get

- **Direction score** (0–100) with five sub-scores: specification, steering, verification, discipline and leverage.
- **Archetype**: Staff Engineer, Architect, Director, Backseat Driver, Rubber Stamper, Slot-Machine Vibecoder, Error Paster…
- **The roast**: a one-line verdict and three reasons for your score, written by your own `claude` or `codex`. Every reason has to cite prompts from what was sent; reasons that cite prompts that don't exist are thrown out.
- **A shareable card**: `amidumb-YYYY-MM-DD.png` (1080×1350) saved where you ran it, and opened for you.
- **Rage meter**: prompts with swearing, CAPS LOCK or `!!!`.
- **Secret leak count**: API keys, tokens and passwords you've pasted into prompts.
- **Three habits to fix**, written as rules you can paste into `CLAUDE.md` or `AGENTS.md`.

## Privacy

- **The score is computed on your machine.** amidumb reads `~/.claude/projects` and `~/.codex/sessions` and runs no servers, no telemetry and no network calls of its own.
- **The roast runs on your own CLI.** It sends about 150 of your prompts to *your own* `claude` or `codex` CLI, on your own plan, and prints one line saying exactly that before it does. `--no-roast` skips it. Each prompt goes with the agent message before it, cut to 300 characters. Tool output and the files the agent read or wrote are never sent, only what you typed and what the agent said.
- **Secrets are redacted before anything is sent**: private keys, AWS, GitHub, Anthropic, OpenAI, Stripe, Slack, Google and npm keys, JWTs, and `password=`-style assignments.
- **`--dry-run`** prints exactly what would be sent, and sends nothing.
- **The judge runs ephemeral** (`claude --no-session-persistence` with no tools, `codex exec --ephemeral` in a read-only sandbox), from an empty folder, so it never ends up in the transcripts it judges.
- **The card never quotes your prompts.** It shows scores and what the judge wrote, which is told to leave out paths, code and names, and is masked again before rendering.
- **`--json`** prints numbers only, with no prompt text, titles or paths, so it's safe to share.

## How the score works (rubric v2)

**The score never comes from the LLM.** An LLM score would change on every run and go easy on whoever is paying for it. The score is a fixed, versioned rubric over signals computed locally, so the same transcripts always get the same score. The LLM only writes the words.

### Every prompt is judged in context

A short prompt isn't a dumb prompt. Each prompt is classified against the agent message right before it:

| class | what it is |
|---|---|
| specify | names a file or symbol, sets a constraint, or says what done looks like |
| instruct | asks for work without any of those |
| question | asks for information |
| approve | "yes", "go", "continue" right after the agent proposed a plan or asked a question |
| nudge | the same words when nothing was proposed |
| correct | pushes back with new information: "no, use the cache instead", "you missed the mobile layout" |
| verify | asks for tests, a review or the diff |
| retry | "fix it", "still broken", "try again", with nothing new |
| error_paste | a pasted error or log, with barely a word of your own |

### Sub-scores

Each sub-score is computed per session, then averaged with every session weighted by its prompt count, capped at 10. Short sessions count for less, and no single marathon session decides your score.

| sub-score | weight | per session |
|---|---|---|
| Specification | 30% | 60% from the share of your instructions that are `specify` (10% scores 0, 60% or more scores 100), 40% from your opening prompt (a full spec with two or more of where, constraints and done-criteria scores 100, one of them 70, a plain instruction 40, a pasted error 0) |
| Steering | 20% | good steering (approvals after a proposal, corrections, interrupts) against bad (bare retries, runs of more than two nudges). A 30% good share scores 0 and 85% or more scores 100. Skipped when there was nothing to steer |
| Verification | 20% | 100 if you asked for tests, a review or the diff, or reported what you saw when you ran it; 60 if only the agent ran tests, lint or a typecheck; 0 if nobody checked. Skipped when no code changed (plans, docs and agent memory don't count) |
| Discipline | 20% | starts at 100 and loses points for bare retries and error pastes (150 × their share), runs of more than two nudges, prompts in bypass-permissions mode, and rage |
| Leverage | 10% | for you as a whole: global instructions (35), projects with a `CLAUDE.md` or `AGENTS.md` (up to 35), three or more skills or commands (15), hooks (15) |

A sub-score that doesn't apply is left out and the other weights are rescaled, so Codex users aren't scored on signals Codex doesn't record. You need at least 5 sessions with two or more prompts, and 30 prompts in total. By default it reads all the history on disk; `--days 30` scores just the last month. Claude Code deletes transcripts after 30 days unless you raise `cleanupPeriodDays` in its settings, so your Claude history may be shorter than you think.

### Archetypes

The first rule that matches wins. How you work comes before how well:

| archetype | rule |
|---|---|
| Error Paster | 15% or more of your prompts are pasted errors |
| Slot-Machine Vibecoder | 25% or more are retries or nudges, and Specification is under 45 |
| Backseat Driver | 25 or more interrupts per 100 prompts, or 25% or more of prompts are corrections |
| Staff Engineer | overall 80+, Verification 70+ and Steering 60+ |
| Architect | Specification 75+ |
| Rubber Stamper | 30% or more are approvals or nudges |
| Director / Mid Vibes / Passenger | overall 60+ / 40+ / below 40 |

## How well does it work?

The honest answer is "better at the extremes than in the middle".

- **Reference personas** are synthetic users at the extremes everyone agrees on, and they're tests: the error paster must score under 30, the slot-machine vibecoder under 35, the architect over 75 and the staff engineer over 80. Any rubric change has to keep them in their bands.
- **Calibration:** the sub-scores were checked against an independent rater that never saw the rubric, on 68 sessions from one heavy user, split into a tuning set and a held-out set.
  - On the held-out set, the opening score ranked sessions the way the rater did 70% of the time; 50% is a coin flip.
  - Verification was about 55%. Most checking (running the app, reading the diff) never shows up in a transcript.
  - Steering couldn't be tested, because that user never got stuck in a retry loop.
- **Scores probably skew high** for anyone who doesn't retry-loop or paste errors.

Disagree with your score? Open an issue with your `npx amidumb --json` output. It's numbers only. Any change to the rubric bumps its version.

## Options

```text
amidumb [options]            your direction score, from Claude Code and Codex sessions
amidumb label [options]      label your own sessions (blind) to sanity-check the rubric
amidumb calibrate            how well the rubric ranks your labelled sessions
amidumb survey [options]     record kinds and keys in your transcripts (no content)

--days <n|all>     window to read (default: all history on disk)
--raw              the full table of raw signals instead of the score
--sessions         one row per session, with titles (stays local)
--sample <n>       print n random detected prompts to check detection (stays local)
--json             numbers only, no text, titles or paths: safe to share
--no-roast         score and card only, nothing is sent anywhere
--dry-run          print exactly what the roast would send, and send nothing
--judge <cli>      claude or codex (default: the first one installed)
--no-open          save the card image without opening it
--claude-dir <p>   Claude Code transcripts (default ~/.claude/projects)
--codex-dir <p>    Codex transcripts (default ~/.codex/sessions)
```

## Supported

- **Claude Code** in the terminal, VS Code and the desktop app, and **Codex** in the CLI, VS Code and the desktop app. Cursor comes later.
- **Node 18.3 or newer.** Tested on macOS; Linux should work. Windows is untested.
- **Transcript formats** aren't documented and change between versions. If your numbers look wrong, `npx amidumb survey` prints the record types and keys in your transcripts, with no content, so you can attach it to an issue.

## Development

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm smoke   # end to end with a fake judge, no tokens
node dist/cli.js --dry-run
```

## License

MIT. The package bundles third-party code, including satori (MPL-2.0) and zod (MIT); `dist/THIRD_PARTY_LICENSES.txt` lists every bundled package with its license and source. The Inter font is under the SIL Open Font License (`assets/fonts/OFL.txt`).
