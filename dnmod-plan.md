# dnmod: plan and handoff

Status on 2026-10-02, `main` of https://github.com/pdudotdev/dnmod (public; see `git log` for the latest commit). This file is the handoff for the next agent: read it all before changing anything.

## TL;DR

- **What dnmod is:** a Claude Code mod, a plugin of function hooks, that shows the session's context fill, its prompt-cache countdown and its spend at a glance, with a switch to 30-day figures.
- **Done:**
  - **Steps 1–2** (proof of concept and tests), plus a **first design pass**.
  - **The band:** two rows above the prompt, with a context bar and a cache bar running green to red, the session total, and a `session│30d` switch.
  - **`/dnmod`:** a side panel. In VS Code, where nothing can draw, it replies in text instead.
  - **`/dnmod check` and `/dnmod demo`.**
  - **Tests:** 25 pass.
- **Step 3 is under way.** Done so far: the **next message's cost**, ported from usdash's engine. The cache pill reads `35:31 left · $0.01 now`, the bar's end cap `then up to $0.28`, and once expired `expired · up to $0.27 to continue` (or `to resume` after an exit). It matches usdash on real sessions. Still to port: today's spend, misses and their causes, Desktop's archived and deleted sessions, and incremental transcript reads. Then step 4 (30-day stats) and step 5 (the details panel). See [Next steps](#next-steps).
- **Before you start:**
  - Load the `plugin-authoring` skill. It writes the API types file, which is the authority.
  - Read [Engine rules](#engine-and-api-rules-learned-the-hard-way) and [The rollout switch](#the-rollout-switch-why-mods-silently-stop-loading). Both cost hours to find.

## Working agreements with the user

- **Commits and pushes:** only when the user says so. They have approved each one so far.
- **Writing for the user:** keep it brief and plain. The user shares dnmod with a team, so the README stays short, accurate and team-facing.
- **Asking questions:** say exactly which UI element a question is about (the **band** above the prompt, or the **side panel** from `/dnmod`). Ask one open decision at a time, and fold in preferences already stated. Colours can't show in text previews, so offer to show colour choices live (hot reload, or `/dnmod demo`).
- **Principles (carried over from usdash):** accuracy, reliability, cleanliness. Never show a figure that may be wrong without saying so. Prefer conservative estimates (e.g. a countdown that is a little short rather than a little long). Hold figures to real transcripts in tests.
- **Standalone:** dnmod must not import, call or need usdash at run time. Port the logic to TypeScript inside dnmod, and copy usdash's fixtures in as dnmod's own tests. Naming usdash as the source in this plan is fine.

## What the user wants

- **For the session you're in:** how full its context is, its cache countdown, and its spend today and in total.
- **For a session you resume** (expired or exited): its context, what resuming costs, and its spend today and in total.
- **30-day figures:** the band's `30d` view. The side panel holds the full breakdown later.
- **The right machine's data:** the local one, or the remote one when Claude Code runs over SSH (VS Code Remote-SSH, Desktop's SSH connections, `ssh` then `claude`).
- **Surfaces:** works on the CLI, Desktop (Code tab) and VS Code, and over SSH.
- **Looks:** professional and easy to take in at a glance, with colour and gradients where they carry meaning.

## Current state

### Built (commit `c803ef0`)

**The band** (above the prompt, CLI and Desktop), in the terminal:
```
● Context  ━━━━━━━━━━━━━━━━━━━━━ 390k / 1M ─────────────────────────────────  39%        total $2.31
● Cache    ━━━━━━━ 52:10 left ───────────────────────────────────────────────  13%    session│30d
```
- **Row layout:** every row has the same columns, with fixed widths in cells (`rowLayout`): a dot coloured by severity with the label, the bar, the value beside it, then an extra column. The bar gets whatever the others leave, so the bars of both rows start and end at the same x and span the row. On the terminal, rows keep 4 columns clear on the right for the engine's `[-]` band marker.
- **The pill:** each bar carries a pill at its fill's leading edge, inside the fill or just past it when the fill is short. It holds the bar's value: `390k / 1M`, `52:10 left`, `expired 4m ago`, `in use`, `no reply yet`. The value beside the bar is the fill in per cent.
- **Context bar:** fills with the context. It stays green to half full, then shades to red when full.
- **Cache bar:** fills as the cache ages, so the share is how much of the cache's life is used. Fresh is green and nearly empty; expired is full and red.
- **Desktop drawing (`svgBar`):** a rounded, faintly grained track; a dot-matrix fill (2×2 dots, pseudo-random strengths) that brightens toward its edge; tick marks at the quarters; and the pill, with its value bright and the unit dimmer. Light pills get dark text (`textOn`). Modelled on a reference the user liked: a dotted, textured progress bar with a pill at the fill's edge.
- **Terminal drawing (`terminalBar`):** a coloured heavy line `━` for the fill, the pill in reverse video, and a grey light line `─` for the rest. Heavy against light and the reverse-video pill read even without colour. There are no tick marks: box-drawing notches joined up between the rows into a grid.
- **`session│30d` switch:** two plain Buttons, the active one bright. The `30d` view is a placeholder: "not computed yet".

**`/dnmod`** opens the side panel, in sections:
- **THIS SESSION:** context and cache bars, wider, with "1h cache" after the countdown, and the total.
- **LAST 30 DAYS:** a placeholder.
- **Footer:** host, OS, Claude Code version, and whether the transcript was read. It is filled after `/dnmod` runs its machine check.

**Other commands:**
- **`/dnmod` in VS Code** prints the figures as text, because VS Code can't draw ([Surfaces](#surfaces)).
- **`/dnmod check`** prints the full machine check: surfaces, host, `~/.claude` and its project folders, the transcript path and size, and a `tail` read of its end. It is meant for SSH and support.
- **`/dnmod demo`** runs 60 seconds in which the cache bar ages from fresh to expired and the context bar sweeps from empty to full, to show the colours.

**Figures:**
- **Context and total:** both come from `$.session.usage()`. Its `cost.usd` is Claude Code's own `/cost` ledger, which includes requests that transcripts never log, such as title generation.
- **Cache clock:** comes from the end of the session transcript, as described under [Accuracy rules](#accuracy-rules-already-implemented).

### Verified

| Where | What was checked | Result |
|---|---|---|
| CLI, macOS (2.1.287) | Band, switch, panel, machine check, figures refreshing after each turn, `/cost` agreeing with the band's total | ✓ (the redesign was seen working in the CLI) |
| Desktop, macOS (2.1.286) | Band, switch, panel only (no chat reply), `$.process.run` (`tail` works) | ✓ for the first version. **Design round 2** (dot-matrix bars, as described above) was previewed in Chromium (Brave, headless) but **is not yet confirmed in the app**. Round 1 had short, misaligned, plain bars, which the user rejected |
| VS Code, macOS (extension 2.1.287) | dnmod loads; `/dnmod` replies with the figures | ✓; **no band or panel possible** (no surface) |
| SSH | Not tested | Pending: [Next steps](#next-steps) |
| Colours in Apple Terminal | Still not visible to the user even after switching to 256-colour codes | Unresolved; the user suspects their terminal theme ([Open issues](#open-issues-and-risks)) |

### Not built yet

Not built yet:
- today's spend
- misses and their causes (usdash's `rewrite_reason`, `_classify`), and the tool-list prefix that stays cached on a miss
- the 30-day stats
- the details panel behind a second button
- releases with version numbers

## Code map

| File | What it holds |
|---|---|
| `.claude-plugin/plugin.json` | Manifest: name, description, author, `"types": "./types/index.d.ts"`. No `version`, so installs follow commits. |
| `.claude-plugin/marketplace.json` | One-plugin marketplace (`"source": "./"`), so `claude plugin marketplace add pdudotdev/dnmod` works |
| `hooks/hooks.json` | `{ "modules": ["./register.tsx"] }` |
| `hooks/register.tsx` | Hooks (`session.start`, `turn.complete`, `session.measure`, `command.run` for `/dnmod`, and `ui.render` for `AbovePrompt` and the `Pane`), plus the transcript lookup, the machine check, the cache refresh and the 1 s ticker |
| `hooks/format.ts` | Pure functions: number formats and `mmss`; the palette `paint(severity, 'terminal' \| 'svg')` and `textOn`; the bar models `contextModel` and `cacheModel` (`fraction`, `severity`, pill `main` and `sub`, `side`); the drawings `svgBar`, `terminalBar` and `textBar`; and `rowLayout` |
| `hooks/cache.ts` | Pure: `readTranscript(lines)`, the main conversation's state from transcript JSONL lines: the cache clock (start, TTL, recaps, compactions), the last request's prompt size, model, speed and region, and whether it's compacted or ended |
| `hooks/prices.ts` | Pure: list prices (`PRICES`, checked 2026-09-29), `modelKey`, `modelVersion`, `pricePaid` (fast mode, US-only), `writePrice` and `promptCost`. Ported from usdash's `prices.py`, `models.py` and `pricing.yaml` |
| `types/index.d.ts` | State contract: `dnmod.view`, `dnmod.probe`, `dnmod.cache` (a `CacheState`, which carries a `TranscriptState`), `dnmod.demoFrom` |
| `tests/*.test.ts(x)` | `band` (mounts the band on terminal and desktop, the pane on all four surfaces, and the demo), `command` (`/dnmod` per surface, `check`, usage), `format`, `cache` (synthetic transcripts with the real shapes) |

State lives in `$.state` atoms (the host keeps them across hot reloads). Module-level `let`s (`transcriptPath`, `countdownEnd`, `ticks`) start over on each load, which is fine.

## How to develop

1. **Load the `plugin-authoring` skill.** It names the types file (`…/plugin-authoring/types/claude-code.d.ts`, about 20k lines): grep it for any API. It also names this session's dev folder, `~/.claude/dev-mods/<session-id>/`, and its examples and `reference.md`.
2. **The repo is the source; the dev folder is a copy.** After each change:
   ```sh
   rsync -a --delete --exclude .git --exclude .env --exclude .claude --exclude .DS_Store \
     --exclude .claude-plugin/types ./ ~/.claude/dev-mods/<session-id>/dnmod/
   ```
   - **First copy:** the first time, Claude Code asks the user "Enable hot reloading for this session?". Once enabled, each edit reloads when your turn ends.
   - **The user's installed copy:** on the user's Mac, `dnmod@dnmod` is installed from GitHub. It is **switched off for `~/Projects/dnmod` only** (`claude plugin disable dnmod@dnmod --scope local`, which writes the gitignored `.claude/settings.local.json`). Two plugins named `dnmod` can't both run: the first in load order wins, so without this the installed copy hides your edits.
   - **Testing other surfaces:** Desktop and VS Code test sessions must be opened in a different folder, where the installed copy is on.
3. **Type-check.** There's no `tsc` installed. Keep a `tsconfig.json` in your scratch folder with the options from the types file's header. Its `include` names the types file and the repo's `hooks`, `types` and `tests`. Then run `npx -y -p typescript@5 tsc -p <that folder>`.
4. **Validate:** `claude plugin validate .claude-plugin/plugin.json`. The shorter `claude plugin validate .` checks only the marketplace. It lists the hooks, the `$` calls, the env names and the state keys, and it refuses rule breaks ([Engine rules](#engine-and-api-rules-learned-the-hard-way)).
5. **Test:** `claude plugin test .`. It refuses to run while the rollout switch is off ([below](#the-rollout-switch-why-mods-silently-stop-loading)).
6. **Ship (when the user says so):** commit and push. Then, on each machine, run `claude plugin marketplace update dnmod && claude plugin update dnmod@dnmod` and start a new session. Auto-update (`/plugin` → Marketplaces → dnmod → Enable auto-update) is off by default.

## Engine and API rules learned the hard way

The API is **early access** (tested on 2.1.283–2.1.287). Re-check these after Claude Code updates.

**Module rules** (the validator and the loader refuse these):
- **Passing `$`:** only to functions declared at the module's **top level**, never to a closure inside `register`. A top-level helper must not share its name with a variable assigned anywhere else in the file.
- **`on`:** never declare a local named `on` (shadowing is refused).
- **Env names:** `$.env.get` takes string literals only. The same goes for `$.state` refs (`{ plugin: 'dnmod', key: '…' } as const`).

**Tests** (`claude-code/testing`):
- **Answering ops:** op hooks answer `{ value: … }`, e.g. `on('session.usage', () => ({ value: {...} }))`.
- **Order:** every hook beneath the plugins must be registered before the test's first `$` call. Use one `test()` per variant instead of re-registering in a loop.
- **Clock:** renders call `$.clock.now()`, so mount tests need `mock.clock(on)`.
- **Commands:** `$.command.run` needs the full input: `{ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen, columns } }`.

**Files and processes:**
- **File types:** `FsEntry.kind` is `'file' | 'dir' | 'other'`.
- **Size limits:** `$.fs.read` rejects files over 4 MiB with no partial reads, and real transcripts are bigger (9.7 MB seen). Read the end or the new bytes with `$.process.run(['tail', '-c', …])`. Its stdout is also capped at 4 MiB (`isStdoutTruncated`).
- **Desktop:** `$.process.run` works there (the types say "CLI only", but it ran).

**Drawing:**
- **`AbovePrompt` (the band):** raised on terminal and desktop only. A `Pane` is raised on every surface.
- **Colours:** plugin `Text` colours accept `#hex`, `rgb()`, `ansi256(n)`, `ansi:<name>` or theme keys.
  - Hex and rgb go out as **24-bit** codes whenever `COLORTERM=truecolor`, which is checked before `TERM_PROGRAM`, and Apple Terminal drops 24-bit colour. (Claude Code itself keeps a 256-colour chalk for Apple Terminal for some of its own colours.)
  - So dnmod uses `ansi256(n)` for the terminal and hex only inside SVG (Desktop).
  - **The diagnosis is incomplete:** after the switch the user still saw no colours ([Open issues](#open-issues-and-risks)).
- **Element tables:** terminal has `Box`, `Text`, `Button`, `Raster`, `Image`, no `Svg`. Desktop has `Svg`, no `Raster`. VS Code's table has `Svg`, but nothing attaches. Narrow `e.surface` before `$.ui.resolve(e)` to reach `Svg`.
- **Buttons:** `plain` draws a Button as bare text; `dimColor` marks the inactive one. The band's Buttons are reached by clicking, or with ctrl+x tab then Enter.

**Redrawing and timers:**
- **Redraws:** `$.ui.invalidate('ui.render')` redraws every instance (band and pane), at most 10 a second (30 for the band and the shown pane). dnmod ticks once a second while a countdown runs, every 30 s otherwise, and 4 times a second during the demo (a timer started by `/dnmod demo` and cancelled with `$.clock.after`).
- **Timers:** `$.clock.every` timers end when the module reloads, and `session.start` runs again on each load. dnmod's ticker calls the `$` captured in `session.start`, as the API's own example does. The countdown visibly ticking in a long idle session is still worth a check.

**Panes and Desktop:**
- **Opening a pane:** a pane opened by the person (a command or a press) seats at any width. Opened unasked, it needs 144 terminal columns.
- **Desktop's older sessions:** Desktop doesn't start an older session's engine when you open it, only when you send a message. Before that there's no engine, so no band.
- **Harmless log noise:** `[WARN] plugin dnmod: options requested but its manifest declares no userConfig`.

## The rollout switch (why mods silently stop loading)

- **The switch:** mods load only while Claude Code's server flag `tengu_plugin_hooks_modules` is on, and the server answers **per Claude Code version**. Probes on 2026-10-02 ran `claude -p "/cost" --no-session-persistence --strict-mcp-config --debug-file …` with each engine, on the same machine and account: CLI 2.1.287 got **on** in 4 of 4 runs, Desktop 2.1.286 **on**, and VS Code's bundled 2.1.283 **off**.
- **One cache per machine:** every engine on a machine writes its answer to **one shared cache**, `~/.claude.json` → `cachedGrowthBookFeatures` (with `cachedGrowthBookFeaturesAt`). Each new process decides at startup from **the cache the previous process left** ("from GrowthBook (the disk cache of an earlier session)"), not from its own answer. So one outdated engine, such as an old VS Code extension, switches mods off for the next CLI and Desktop sessions too.
- **Fix:** keep **every** Claude Code on a machine at 2.1.286 or later (the README says so). The VS Code extension bundles its own engine under `~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude`; Desktop's is under `~/Library/Application Support/Claude/claude-code/<version>/`.
- **Diagnosis:** grep debug output for `rollout flag (tengu_plugin_hooks_modules) is off, from …` and `hooks module dnmod@dnmod loaded|not loaded`. VS Code's extension log (`~/Library/Application Support/Code/logs/<date>/window1/exthost/Anthropic.claude-code/Claude VSCode.log`) mirrors the engine's debug lines. For the CLI, use `--debug-file`.
- **What not to do:** don't hand-edit the cache. 2.1.283 also accepts `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, but it would still write "off" to the shared cache.

## Surfaces

- **Terminal (CLI):** band and pane. Colours are 256-colour codes. Bars are `━` and `─` with a reverse-video pill.
- **Desktop (Code tab):** band and pane. Bars are dot-matrix SVGs (`svgBar`), with colours blended smoothly in hex.
  - **Sizing:** Desktop reports widths in cells of its code font, never in pixels, and a `Client` region doesn't measure pixels either. With no `width` prop, Desktop draws an SVG at its markup's own width, capped by the room it has. With fixed width and height, Chromium stretches an SVG image unevenly, squashing its text and dots.
  - **What dnmod does:** it draws each bar in a viewBox of `cells × 9` units (`SVG_UNITS_PER_CELL`), which is more than a cell's pixels, and passes neither `width` nor `height`. Desktop then scales it **down uniformly** to its fixed-width Box, so the bar fills the box and nothing is distorted.
  - **Caveat:** this rests on the docs and a Chromium preview, not yet on the app itself.
  - **Previewing without the app:** render the real `svgBar` and `terminalBar` from `hooks/format.ts` with `npx tsx`, lay them out as Desktop would (`<img style="max-width:100%;height:auto">` in boxes of `cells × ~7.8 px`), and screenshot with a headless Chromium (`Brave Browser --headless=new --screenshot`). Then look at the PNG.
- **VS Code (extension 2.1.287):** dnmod loads, but the engine runs headless ("session.start: raised (surface none, not interactive)", `$.session.surfaces()` = `[]`). So there's no band and no pane, and `$.ui.open` still answers `placed`. `/dnmod` therefore checks `surfaces.length > 0` and otherwise returns the figures as text (`tests/command.test.ts`). Revisit when the extension attaches as the `vscode` surface.
- **SSH:** the mod runs inside the engine, so on the remote machine, and reads that machine's `~/.claude`. Install dnmod on the remote. The repo is public, so no GitHub credentials are needed. **To verify:** adapt usdash's manual check 5 (`tests/sanity/manual.py` in usdash). From VS Code Remote-SSH and from Desktop's SSH connection, run `/dnmod check`: the `host:` line must name the remote machine, and the transcript must be the remote one.

## Design (decided)

- **The band is the main UI.** It has two rows that keep their height: the context row and the cache row. The `30d` view uses the same two rows.
- **Where step 3's figures go:** the extra column (`rowLayout`'s `extra`, now 17 cells), widened as needed.
  - context row: `today $0.43 · total $1.20`
  - cache row, before the switch: `next msg $0.02` (warm) or `$0.36` (cold)
- **Both bars fill toward trouble.**
  - Severity runs 0 → 1, green → red, in a muted palette of 256-colour codes: 71 → 107 → 143 → 179 → 173 → 167.
  - The empty track is grey 242.
  - SVG uses brighter hex stops, blended smoothly: `#3fb950` → `#9fc243` → `#e3b341` → `#f0883e` → `#f85149`, with track grey `#8b8b8b`.
  - Context severity is 0 to half full, then rises linearly to 1 when full.
  - Cache severity is the elapsed share of the TTL.
- **Pill text is plain words:** `390k / 1M`, `52:10 left`, `expired 4m ago`, `in use`, `no reply yet`. The user found `59:22 left 1h` confusing, so the TTL appears only in the side panel (`1h cache`).
- **The look:** the user wants professional and polished, not "a home project at its first draft": long aligned bars, texture, ticks and pills, like their reference. Judge every change with a rendered preview before showing it.
- **The side panel stays secondary.** It uses sections (THIS SESSION, LAST 30 DAYS) and a dim machine footer. Later it gets a second small button for the full breakdown: by day, model and project, the costliest prompts, and the resume costs of other sessions.
- **30-day stats are computed once and shared** through `$.store` (at most 4 MiB of JSON): whichever session finds the stored copy older than about a minute recomputes it for all.
- **Resuming:** a resumed session gets the band at once, with the cold-cache `up to $…` before anything is sent.

## Accuracy rules already implemented

- **Cache clock** (`hooks/cache.ts`, from the last 256 KiB of the transcript):
  - **Main thread only:** take the last main-thread request, grouped by `message.id` with `isSidechain` replies excluded.
  - **Start time:** the clock starts at the request's **trigger**. Walk up `parentUuid` from its first reply record, past `attachment` records, to the prompt or tool result. The start is the earlier of that time and the first reply's. Real sessions showed the first reply record arriving up to 1m42s after the request started, so timing from the reply would overstate the time left.
  - **TTL:** as usdash, from the last request that wrote to the cache: 1 hour if it wrote any `ephemeral_1h_input_tokens`, else 5 minutes if it wrote any 5-minute or unsplit tokens. A pure cache read keeps the earlier write's TTL. With no write found, it assumes 5 minutes.
  - **Recaps and compactions restart the clock:** an `away_summary` at its time minus 5 s (usdash's `RECAP_LAG`), and a `compact_boundary` at its time minus `compactMetadata.durationMs`, when these are later than the last request.
  - **During a turn:** the band reads `in use`, because each request refreshes the cache. After `turn.complete` the clock is re-read from the transcript.
- **Next message's cost** (`resend` and `resendLine` in `hooks/format.ts`; usdash's `engine.py`):
  - **C:** the last main request's prompt (uncached + read + written), with errors and `<synthetic>` replies skipped.
  - **now** (while warm) = C × the cache-read price.
  - **up to** (once expired) = C × the cache-write price for the TTL. It's an upper bound, because Claude Code's tool list often stays cached.
  - **Prices:** paid at the last request's model, speed and region.
  - **Wording:** "next message" while warm, "continuing" once expired, and "resuming" after an exit (a `cost-state` record with nothing typed or sent since).
  - **After `/compact`:** no costs until the next request measures the new size.
  - **Where it shows:** in the band it lives in the cache bar's pill and end cap. The side panel and the VS Code reply show usdash's full sentence.
  - **Checked against usdash** on 2026-10-02 (`python3 -m usdash --once` vs dnmod's `readTranscript` + `resend` on the same transcripts): `continuing re-sends 34k tokens: up to $0.28`, `… 55k tokens: up to $0.44` and `… 34k tokens: up to $0.27` matched exactly. This session's figures differed by one request that landed between the two runs.
- **Transcript lookup:** `~/.claude/projects/<cwd with non-alphanumerics as '-'>/<session id>.jsonl`. If it isn't there, search the project folders for the session id; retry until the transcript exists. `CLAUDE_CONFIG_DIR` is honoured.

## Next steps

### Step 3: port the engine for the band

**Source:** usdash, public at https://github.com/pdudotdev/usdash and on the user's Mac at `~/Projects/usdash`.
- **Rules:** `usdash/sessions.py` (740 lines), `prices.py`, `models.py`, `facts.py` and `engine.py` (about 240 lines together), and `transcripts.py` (246 lines).
- **Background:** `research/AI-TOKENOMICS-GUIDE.md` documents the measured Claude Code behaviour behind the rules.
- **Don't port:** `ui.py` and `app.py`. Port `docs.py` (live price-page parsing) only if needed; shipping prices in code and updating them with releases is fine.

**Port:**
- **Transcript reading:** tolerant JSONL with slim records, plus **incremental reads**. Keep a byte offset per transcript in `$.state` and read only new bytes with `tail -c +N`; mind the 4 MiB caps.
- **Done:** requests grouped by `message.id`, with the start from the attachment chain; prices with the fast-mode and US multipliers (`hooks/prices.ts`); the next message's cost; and recaps and `compact_boundary` on the clock.
- **Today's spend:** per-request cost summed per local day (`request_cost` in usdash's `prices.py`). The session total keeps coming from `$.session.usage().cost.usd`. **Check how usdash reconciles the two** (`cost-state` / `claude_total`) before mixing them. Local days need the machine's time zone: the plugin environment may run in UTC, so get the offset with `$.process.run(['date', '+%z'])`.
- **Misses and their causes,** needed for step 4: usdash's `rewrite_reason` and `_classify`, and the tokenizer ratio in `facts.py`/`models.yaml`.
- **Desktop sessions:** archived and deleted ones, and queued prompts (`queued_command`).

**Tests:** copy usdash's real-transcript fixtures (`tests/fixtures/checks`, 8 redacted sessions from Claude Code 2.1.283) into dnmod. Assert the same figures as usdash's `tests/test_real_checks.py`, so both tools are held to the same numbers. The figures will exist in two places, so fixes must be mirrored.

### Step 4: the 30-day view

- **Port:** `usdash/stats.py` (390 lines). Compute once and share via `$.store`, recomputing only when the stored copy is older than about a minute.
- **The band's `30d` rows:**
  - `30d $48.62 · $33.89/day`
  - `99% cached · misses $1.36 (3%) · Opus 5.5 93% of spend` (wording to settle with the user)
- **Tests:** hold the figures to hand-worked sums, like usdash's `tests/test_stats.py`.

### Step 5: the details panel and releases

- **The panel:** a second small button in the band opens the full breakdown (above).
- **Releases:** once dnmod is stable, switch from tracking commits to `version` bumps in `plugin.json`, and mention auto-update in the README.

### Also pending

- **SSH check** ([Surfaces](#surfaces)).
- **Desktop look of the redesign:** push, update, then open a Desktop session in another folder. Check the SVG bars, spacing and colours.
- **Narrow terminals:** decide what drops first, likely `next msg`, then `today`, then the token amounts, never the bars. Check light themes.

## Open issues and risks

- **Colours in Apple Terminal:** they still don't show for the user after the switch to `ansi256(n)`. They suspect their terminal theme. Ideas to check:
  - whether Claude Code's own colours show in that terminal
  - whether the profile shows ANSI colours
  - theme keys (`success`, `warning`, `error`) instead of codes
  - `Raster` for the bars, which takes 24-bit cell colours and so is likely no better on Apple Terminal
- **Early-access API:** it can change between releases, and the rollout switch can change too. dnmod depends on both.
- **VS Code:** text only, until the extension attaches as a drawing surface.
- **Same-named plugins:** the dev copy and the installed copy (see [How to develop](#how-to-develop)).

## Decisions made so far (history)

- **Port, don't wrap:** a thin UI over usdash's Python engine was rejected (the standalone requirement). The rejected alternative also needed Python 3.11+ and its own installer on every machine. So: port to TypeScript, installed with `/plugin install` anywhere Claude Code runs.
- **Distribution:** the GitHub repo is its own marketplace. The README's install is two shell commands, once per machine, covering the CLI, Desktop and VS Code there. A per-surface in-app install table was removed as redundant.
- **Repo:** created private on 2026-10-02 and **made public** the same day, with this plan in it.
- **Design round 1:**
  - The user chose **two rows** over one.
  - They asked for a **cache bar that moves green → red**.
  - After seeing it, they asked for it to **fill (not drain)** as the cache ages, to match the context bar.
  - They found `59:22 left 1h` confusing, hence `expires in 59:22`.
- **`/dnmod` output:** prints nothing in the chat where the panel draws, since a chat reply also enters the model's context. It prints only where nothing draws (VS Code).
