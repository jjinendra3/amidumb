# amidumb

`npx amidumb` is a one-time run that reads your AI coding transcripts (Claude Code, Codex) and tells you whether you **direct** your agent like an engineer or just **vibecode**. You get a score, an archetype and a roast grounded in your own prompts, saved as a shareable image.

It's a viral side project, nothing more. The goal is reach: ship in 1–2 weekends, launch on X/HN with my own card as the demo.

Status: **no code yet.** Planned in a Claude Code session on 2026-10-26 (`~/Repos`, session `b08464ae-a5a2-477e-9179-c228959484ad`). Next step: scaffold, then build the collectors and fixed metrics first, so real numbers exist before the LLM part.

## Decisions already made

- **TypeScript, not Go.** `npx` is the hook and it's native to Node. A Go binary behind npx needs goreleaser plus an npm wrapper with per-platform `optionalDependencies`, about a day of release plumbing. The share card is easier in JS (satori + resvg). Speed doesn't matter: ~630 MB of logs streams in a few seconds in Node.
- **Stack:** Node >= 18, tsup bundle, few dependencies, zod to validate the judge's output. Terminal output via Ink or chalk + boxen.
- **Name:** keep `amidumb`. The name doesn't say AI or coding, so the tagline does that everywhere (npm description, README first line, the card): something like "your AI coding transcripts, judged". It was free on npm on 2026-10-26. Check again before publishing.
- **Tone:** judgemental, Spotify Wrapped style. Existing tools (claude-doctor, Prompt Coach, Introspect) read as diagnostics and coaching. The tone and the share card are the only edge.

## Hard rules

1. **The score comes from fixed local metrics, never from the LLM.** An LLM score changes on every run, people rerun until it's good, and models go easy on whoever is paying. The LLM only writes the verdict and the roast.
2. **Credibility is everything.** Calling an obvious vibecoder a staff engineer (or the other way round) gets it dunked on publicly. Every roast point must cite real prompts from the sample as evidence. The ids are checked locally and the prompts are never quoted on the card (decided 2026-11-01: quoted prompts on a shareable image leak private work).
3. **Don't send the whole transcript.** Tool output is most of it and it's noise. Do the heavy work locally and send a small, curated sample: about 150 prompts, each with the assistant turn before it cut to about 300 chars. That's ~30k tokens per run, from the user's own plan quota.
4. **A short prompt isn't a dumb prompt.** "yes, go" after a good plan is good direction, and "fix it" on loop is vibecoding. Judge prompts in context. The real question is whether the user specifies, constrains, verifies and corrects.
5. **Privacy:**
   - No telemetry, ever.
   - No network calls except the user's own CLI.
   - Redact secrets with regexes before anything leaves the machine.
   - `--dry-run` prints exactly what would be sent.
   - Keep code quotes out of the share card by default.
   - Open source, with code small enough to read.
6. **No leaderboards or global percentiles in v1.** They need uploads, and uploads kill the privacy pitch.

## Data sources

None of these formats is documented and they change between versions. Parse defensively and skip unknown record types and keys.

- `~/.claude/history.jsonl`: only the user's prompts, with fields `display, pastedContents, timestamp, project, sessionId`. The cheapest strong signal.
- `~/.claude/projects/*/*.jsonl`: full Claude Code transcripts. Record types include `user`, `assistant`, `attachment` and `permission-mode`. Fields include `permissionMode`, `gitBranch` and `toolUseResult`. Interrupts, tool-call rejections, plan mode and effort come from here.
- `~/.codex/sessions/YYYY/MM/DD/*.jsonl`: Codex transcripts.
- Cursor: later. Its history sits in SQLite, so it's harder.

When building, inspect formats with scripts that print only keys, record types and counts. Don't dump raw transcripts into agent context: it's expensive and the content is private.

## Metrics (computed locally, no LLM)

| Area | Signals |
|---|---|
| Specification | Prompt length distribution, % of prompts naming files, paths or symbols, constraint words ("only", "don't", "must"), acceptance criteria |
| Steering | Interrupt rate, tool-call rejections, corrections ("no, instead…"), plan mode usage |
| Verification | Tests or typecheck run in the session, review requests, "show me the diff" |
| Vibe signals | "still not working" / "fix it" loops, prompts that are only a pasted error, share of time in bypassPermissions, long runs of "continue", 50+ turns on the same bug |
| Leverage | CLAUDE.md / AGENTS.md present, custom skills, hooks |

## Pipeline

`collect → normalize → metrics → redact + sample → judge → validate (zod) → render`

- **Judge:** use whichever CLI is installed: `claude -p --output-format json` or `codex exec`. Strict rubric, JSON-only output. Check the exact flags when building.
- **Output:**
  - A 0–100 "direction score" with 4–5 sub-scores.
  - An archetype. Examples: Slot-Machine Vibecoder, Error Paster, Backseat Driver, Architect, Staff Engineer.
  - A one-line verdict and 3 reasons for the score, each backed by sample ids that are checked but not shown.
  - A 1080×1350 PNG card (satori + resvg) saved in the folder it was run from, and opened. No consent prompt: the run says what it sends and `--no-roast` skips it.

## MVP scope

- Claude Code and Codex only.
- Last 30 days.
- Terminal output.
- Card sections for a **rage meter** ("wtf", all-caps prompts, "still broken" loops) and a **secret leak count** ("you've pasted N API keys into Claude"). Both need only regexes, no LLM.

## Later

- `npx amidumb wrapped` for December Wrapped season: hours with AI, top projects, peak coding hour, longest session, most-cursed bug, Claude-vs-Codex split. A second launch from the same package.
- A Claude vs Codex head-to-head: which one you correct, interrupt and give up on more often.
- "Rerun monthly and watch your score improve", plus 3 habits to fix written as CLAUDE.md / AGENTS.md rules.
- Cursor support.
- If more of these tools happen, pull the collectors and normalizer out into a shared package (e.g. `agentlogs`).
