# hireable

[![skills.sh](https://skills.sh/b/0xmigi/hireable)](https://skills.sh/0xmigi/hireable)

A personal job-search skill for AI agents. You bring the job listings; the agent runs the rest — resume, applications, pipeline, follow-ups, offers. Markdown is the source of truth; a local dashboard renders it.

Works in Claude Code, Codex, OpenClaw, Cursor, Hermes, and anywhere else the [`skills`](https://github.com/vercel-labs/skills) CLI runs.

## Install

```bash
npx skills add 0xmigi/hireable
```

The CLI asks which agent and where to install. Pick whatever you want.

## Use

Open a session in your agent and say:

> let's set up my job search

The skill takes it from there — creates your workspace, starts the local dashboard, and opens it in your browser. Subsequent sessions auto-revive the dashboard if it's been killed.

## Uninstall

```bash
npx skills remove hireable
```
