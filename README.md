# dnmod

**TL;DR:** a Claude Code mod that shows, above the prompt, how full your session's context is, how long its prompt cache stays warm, what the next message will cost, and what the session has cost today and in total. One click switches it to your last 30 days.

## What you see

**This session** (the band's default view):

| Row | Shows |
|---|---|
| **Context** | How full the context is (`390k / 1M`), green to red. Beside it, `today $… · total $…` for this session |
| **Cache** | Fills as the prompt cache ages: `35:31 left · $0.01 now`, capped by `then up to $0.28` (what the next message costs once the cache expires). Expired: `expired · up to $0.27 to continue` |

**Last 30 days** (press `30d`), across every session on this machine:

| Row | Shows |
|---|---|
| **Spend** | Spend by day, the total and per day |
| **Misses** | What cache misses added, split by cause (cache expired, Claude Code upgraded, …) |
| **Models** | Spend by model, fast mode apart |
| **Projects** | Spend by project folder |
| **Context** | Spend by context size when sent: big contexts are where cost piles up |

**Commands:** `/dnmod` switches the band between the two views (as does clicking `session│30d`, or `ctrl+x tab` then `Enter`); `/dnmod check` shows what dnmod can read on this machine (useful over SSH); `/dnmod demo` runs the bars through their colours in 60 seconds.

**Where:** the band shows in the CLI and the Desktop app's Code tab. The VS Code extension can't draw for mods yet: there `/dnmod` replies with the figures as text.

## How it works

dnmod runs inside Claude Code itself, so there's no separate app or server, and nothing is sent anywhere. It reads Claude Code's own figures for the session, and the transcripts in `~/.claude` for the rest, priced at Anthropic's list prices (on a subscription, they're for comparison). Over SSH it runs on the remote machine and reads that machine's sessions.

## Install

**You need:**
- Claude Code 2.1.287 or later in **every** Claude Code app on the machine: the CLI, Desktop and the VS Code extension. Mods are early access and switched on per version, and one older install on the machine can switch them off for the others.
- git: Claude Code downloads dnmod from GitHub with it.

**Install once per machine, from a shell.** It then works in the CLI, Desktop and VS Code on that machine:

```sh
claude plugin marketplace add pdudotdev/dnmod
claude plugin install dnmod@dnmod
```

Then start a new session, or run `/reload-plugins` in an open one.

**Over SSH** (VS Code Remote-SSH, Desktop SSH sessions, or `ssh` then `claude`): run the two shell commands on the **remote** machine.

**Update:** an install stays on the version it was installed at until you update it:

```sh
claude plugin marketplace update dnmod && claude plugin update dnmod@dnmod
```

Then start a new session. To skip this in future, turn on auto-update: in the CLI run `/plugin`, then **Marketplaces** → dnmod → **Enable auto-update**. New versions then download by themselves, and the next session you start uses them.

**Uninstall:** `claude plugin marketplace remove dnmod` (this also removes the plugin)

**Band or `/dnmod` missing?** Update every Claude Code app on the machine (VS Code: Extensions → Claude Code → Update), then start a new session.

## Development

See [dnmod-plan.md](dnmod-plan.md) for the design, the mod API's quirks and what's next.
