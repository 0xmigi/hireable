# hireable

A personal job-search operations skill. The user brings job listings; the agent manages every thread that follows — master resume, tailored derivatives, application briefs from real form fields, pipeline tracking, follow-up drafting, offer comparison. Markdown is the source of truth; a local dashboard is a view over it.

Designed to be **agent-harness agnostic**. Tested primarily on Claude Code, built to work on Codex, OpenClaw, Cursor, Hermes, and any harness the [`skills` CLI](https://github.com/vercel-labs/skills) supports.

## Install

```bash
npx skills add 0xmigi/hireable
```

The CLI will ask which agent (Claude Code / Codex / OpenClaw / Cursor / Hermes / etc.) and whether to install globally or per-project. Pick whichever you want — the skill works the same in any of them.

Then start a fresh session in that agent and say something like *"let's get my job search set up"*. The skill will activate, ask where to put your workspace (default `~/job-search/`), and walk you through getting your master resume in.

## Uninstall

```bash
npx skills remove hireable
```

This removes the skill from your agent. Your **workspace files** (job notes, dashboard, profile) stay where you put them — they're yours, not the skill's. Delete that directory manually if you want to start clean.

## What's inside

| File | Purpose |
|---|---|
| `SKILL.md` | The instructions the agent loads. Branches the session: workspace bootstrap → master resume → channels → operating mode (positioning / application / pipeline / follow_up / offer). |
| `references/*.md` | Playbooks the agent follows for specific operations: listing extraction, application brief generation, resume tailoring, stale-thread radar, PDF export, follow-up drafting. |
| `templates/*.md` | Markdown skeletons for new job notes and follow-up drafts. |
| `scripts/build-dashboard.mjs` | Builds the local dashboard HTML from workspace Markdown. |
| `scripts/serve-dashboard.mjs` | Serves the dashboard with auto-reload on file changes. |
| `workspace-template/` | What gets copied to the user's workspace on first run (empty `profile.md`, `targets.md`, `references/application-answers.md`). |
| `commands/hireable-*.md` | Optional Claude Code slash commands (`/hireable-ingest`, `/hireable-tailor`, etc.). Copy to `~/.claude/commands/` if you want autocomplete in CC. The natural-language triggers in `SKILL.md` work in any harness without these. |

## Named commands

The skill exposes five named operations the user can invoke by phrase. These work in any harness:

| Phrase | What it does |
|---|---|
| `hireable help` | Print the commands table. |
| `hireable ingest <url>` | Fetch a listing and scaffold a populated job note. Handles job boards (Workable / Lever / Ashby / Greenhouse / Gem / direct) and social posts (X / LinkedIn / Telegram pastes / warm-intro forwards). |
| `hireable autofill <slug>` | Fetch the actual application form for a job and generate the Application brief from real form fields, populated from `profile.md` + `references/application-answers.md`. |
| `hireable radar` | Surface stale threads with proposed nudges, ranked by urgency. |
| `hireable tailor <slug>` | Propose 3–5 specific resume bullet swaps for a role, generate a tailored PDF. |

## Design principles

- **Never fabricate.** Every name, date, metric, resume bullet, or outbound message comes from the user, a workspace file, or a connected channel. Empty is fine; `[needs:<field>]` markers track what's missing.
- **Defer to the user on approach.** Ask before assuming.
- **One topic at a time.** No interrogations.
- **Persist durable updates to Markdown.** The dashboard is a view; the Markdown is the source of truth.
- **Surface failures honestly.** Don't fall through to a worse implementation silently. If a vendor-shipped `pdf` skill isn't available and `pandoc` lacks `xelatex`, tell the user the install command rather than producing an ugly PDF.

## Dashboard

After workspace bootstrap, run from the workspace:

```bash
node scripts/build-dashboard.mjs   # one-shot build
node scripts/serve-dashboard.mjs   # serve with auto-reload
```

Then open `dashboard/index.html` (or the URL the serve script prints) in a browser.

## License

MIT.
