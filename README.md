# hireable

[![skills.sh](https://skills.sh/b/0xmigi/hireable)](https://skills.sh/0xmigi/hireable)

A personal job-search skill for AI agents. You bring the job listings; the agent runs the rest — resume, applications, pipeline, follow-ups, offers. Markdown is the source of truth; a local dashboard renders it.

Works in Claude Code, Codex, OpenClaw, Cursor, Hermes, and anywhere else the [`skills`](https://github.com/vercel-labs/skills) CLI runs.

## Install

```bash
npx skills add 0xmigi/hireable
```

The CLI asks which agent and where to install. Pick whatever you want — global is the most common choice.

## Use

Open a session in your favorite agent and tell it to set up your job search:

```bash
# Claude Code
claude
# or Codex
codex
# or OpenCode, Cursor, etc.
```

Inside the session:

> let's set up my job search

The skill takes it from there — creates your workspace at `~/job-search/` (you can pick another path), starts a local dashboard, and opens it in your browser. Subsequent sessions auto-revive the dashboard if it's been killed and pick up exactly where you left off, regardless of which directory you launched the agent in.

### Hermes

Hermes isn't yet a target the [`skills`](https://github.com/vercel-labs/skills) CLI knows about. After installing, add a one-line symlink so Hermes sees the skill:

```bash
ln -s ~/.agents/skills/hireable ~/.hermes/skills/hireable
```

## Uninstall

```bash
npx skills remove hireable
```
