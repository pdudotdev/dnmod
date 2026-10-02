# dnmod

**TL;DR:** a Claude Code mod that shows, at a glance, how full your session's context is and what the session has cost, with one click to switch to your last 30 days.

> Early version: the band shows context and session cost. The cache countdown, today's spend, resume cost and the 30-day figures are coming next.

## What you see

| Where | What | Surfaces |
|---|---|---|
| **Band** above the prompt | `context 11% (109k of 1.0M) · total $1.74   30 days` | CLI, Desktop |
| **`30 days`** button in the band | Switches the band between this session and the last 30 days | CLI, Desktop |
| **`/dnmod`** side panel | The same figures, plus a check of what dnmod can read on this machine | CLI, Desktop |
| **`/dnmod`** reply in the chat | The same, as text. VS Code can't draw bands or panels for mods yet | VS Code |

To press the band's button: click it, or press `ctrl+x tab` and then `Enter`.

## How it works

dnmod runs inside Claude Code itself, so there's no separate app or server, and nothing is sent anywhere. It reads Claude Code's own figures for the session, and the transcripts in `~/.claude` for history. Over SSH it runs on the remote machine and reads that machine's sessions.

## Install

**You need:**
- Claude Code 2.1.286 or later in **every** Claude Code app on the machine: the CLI, Desktop and the VS Code extension. Mods are early access and switched on per version, and one older install on the machine can switch them off for the others.
- Read access to this private repo (ask the owner), and git signed in to GitHub. Either run `gh auth login` then `gh auth setup-git`, or have a GitHub SSH key loaded in your ssh-agent.

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
