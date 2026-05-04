---
name: hireable
description: Use when helping a user run their personal job-search operations from a local Markdown workspace. Covers master resume + derivatives, positioning, tailored applications, active pipeline tracking, follow-up communication, offer comparison, and dashboard regeneration. The user finds jobs themselves; this skill processes everything that happens after they bring one to you.
---

# hireable

A personal job-search operations workspace. The user brings job listings they have found; you manage every thread that follows. Markdown is the source of truth; the dashboard is a view over it.

This skill is **not** a job-search tool. You do not crawl boards, recommend listings, or source roles.

## Harness compatibility

This skill is designed to be **agent-harness agnostic**. The contract is: an agent that can read these instructions, read and write workspace files, optionally fetch URLs, and optionally call MCPs — should be able to run hireable. Tested primarily on Claude Code, but built to work in Codex, OpenCode, Hermes, and any equivalent harness that exposes those primitives.

A few harness-specific notes the skill is aware of:

- **Slash commands** — `~/.claude/commands/hireable-*.md` files exist as a Claude Code-specific autocomplete affordance. They are convenience, not contract. The canonical interface is the natural-language triggers in the [Commands](#commands) section below — `ingest <url>`, `autofill <slug>`, `radar`, `tailor <slug>`, `help`. Type those phrases in any harness and the same playbooks fire.
- **Sub-agent / background-worker dispatch** — when a playbook says "delegate this to a background worker," each harness binds that to its own mechanism: Claude Code's `Agent` tool (with optional Haiku model override), Codex's task delegation, etc. If your harness has no delegation primitive, perform the work inline in the main thread — it just costs more main-thread tokens. Never block on a feature that doesn't exist.
- **External skill delegation** — when a playbook says to use an "Anthropic-shipped `pdf` skill" (or similar named skill from a vendor's bundle), it means: use one if your harness has it; fall back to the documented local-tool chain otherwise. Don't fail because a specific skill name isn't registered.
- **MCPs** — Gmail / Calendar / Slack / Telegram / Chrome MCPs are detected and used opportunistically. If they're available, lean on them; if not, fall back to the manual paths the playbooks document.

The dashboard (a local HTML file rebuilt from Markdown by `scripts/build-dashboard.mjs`) runs as a separate process and doesn't depend on any agent harness. Any agent that writes correctly-formatted `.md` files into the workspace will trigger the dashboard to update.

## Where you operate

There are two distinct directories you should keep clear:

- **The skill directory** — where this `SKILL.md` lives, plus the read-only playbooks (`references/`), templates, scripts, and a `workspace-template/` directory the skill ships. After install via `npx skills add`, this lives somewhere like `~/.claude/skills/hireable/` (path varies per harness — the `skills` CLI manages it).
- **The user's workspace** — where job notes, the user's `profile.md`, the user's master resume, the running dashboard, etc. live. Typically `~/job-search/` or wherever the user chose during first-run setup.

The skill directory is read-only. The user's workspace is where you read and write. **All session work happens inside the workspace** — never modify the skill directory.

Find the workspace using this rule, in order:
1. If `~/.config/hireable/workspace` exists, read it — its first line is the workspace path. Verify the path exists and contains a `.hireable/` marker; if so, use it. (This is the durable pointer written by Branch 0 — it survives `npx skills update` and works regardless of cwd.)
2. If the current working directory contains a `.hireable/` marker directory, that's the workspace.
3. Walk up parent directories looking for `.hireable/`. If found, use that ancestor as the workspace.
4. If `~/job-search/` exists and has a `.hireable/`, use it (legacy default).
5. Otherwise, the workspace doesn't exist yet — go to **Branch 0** below.

## How this skill works

Job searches are deeply personal — every user runs theirs differently. Your job is **not** to execute a fixed playbook. Your job is to walk the user through a small set of universal goalposts (resume → channels → constraints → applications → follow-ups → offers) in the way that fits how *they* want to work.

That means:

- **Never fabricate.** Every name, date, metric, resume bullet, or outbound message comes from the user, from a workspace file you have read, or from a connected channel you have read in this session. Placeholder content like `[Your Name]`, `Master_Resume_YYYYMMDD.pdf`, or invented bullet points is a bug. Empty is fine.
- **Defer to the user on approach.** When a goalpost has multiple valid paths (build a resume from scratch vs. import an existing one; track via Gmail vs. paste messages manually), ask which the user prefers before doing the work.
- **One topic at a time.** Ask, wait, listen, then act. A short, focused form (e.g. the five constraints questions in Branch 3) is fine when you're collecting clearly-defined data the user has agreed to share — but never chain unrelated decisions, and never ask "are you ready to proceed."
- **Persist durable updates to Markdown.** The dashboard is a view; the Markdown is the source of truth.

## Every session begins the same way

If the workspace already exists, read `profile.md` and branch on what you find. The branches below are ordered. Take the first one that applies.

If the workspace doesn't exist yet, run **Branch 0** first.

### Dashboard liveness check (run before any branch)

Before doing anything else in an existing workspace, ensure the dashboard is alive:

1. Read `<workspace>/.hireable/dashboard.json`. If it exists and the `pid` is still running (`process.kill(pid, 0)` doesn't throw), the dashboard is up at `http://localhost:<port>` — don't restart it, don't re-open the browser, just continue.
2. If the pidfile is missing or the PID is dead, run `node scripts/init.mjs` from the workspace. The script handles the start-vs-revive decision and opens the URL in the browser. Mention the URL once in your reply, then move on.

This check is silent unless something changes. Don't narrate "checking dashboard..." — just run it.

### Branch 0 — Workspace bootstrap (first-time setup)

The user installed the skill via `npx skills add` but hasn't created their workspace yet. Open with one message:

```text
Looks like this is your first hireable session. I need to set up a workspace where your job notes, profile, and dashboard will live.

Where should I put it? [default: ~/job-search]
```

Wait for the user's answer (or take the default). Then run these shell commands yourself (do **not** ask the user to run them):

```bash
WORKSPACE="<chosen-path>"   # e.g. ~/job-search, expand ~ before use
TMPDIR=$(mktemp -d)
git clone --depth 1 https://github.com/0xmigi/hireable.git "$TMPDIR/hireable-bootstrap"
mkdir -p "$WORKSPACE"
cp -R "$TMPDIR/hireable-bootstrap/hireable/workspace-template/." "$WORKSPACE/"
cp -R "$TMPDIR/hireable-bootstrap/hireable/scripts"     "$WORKSPACE/scripts"
cp -R "$TMPDIR/hireable-bootstrap/hireable/templates"   "$WORKSPACE/templates"
cp -R "$TMPDIR/hireable-bootstrap/hireable/references/." "$WORKSPACE/references/"
rm -rf "$TMPDIR"
mkdir -p "$HOME/.config/hireable"
echo "$WORKSPACE" > "$HOME/.config/hireable/workspace"
cd "$WORKSPACE" && node scripts/init.mjs
```

The `~/.config/hireable/workspace` pointer is the durable "where is this user's workspace" record. It lives outside the install dir so it survives `npx skills update` cleanly, and it lets the agent find the workspace from any cwd in future sessions.

`workspace-template/` provides `profile.md`, `targets.md`, the `.hireable/` marker, and empty `resumes/` and `dashboard/` directories. `scripts/`, `templates/`, and the playbooks in `references/` are copied so the workspace is self-contained — the agent operates with the workspace as cwd and all relative paths resolve correctly.

After init.mjs finishes:

1. Read `<workspace>/.hireable/dashboard.json` to confirm the dashboard launched. If the file is missing or its `pid` isn't alive, dump `<workspace>/.hireable/dashboard.log` to the user and stop — don't proceed to Branch 1 with a broken dashboard.
2. Tell the user one line: `Workspace at <path>. Dashboard opening at http://localhost:<port>.`
3. Continue to Branch 1 — the master resume bootstrap.

This bootstrap does not depend on `npx skills add` shipping anything beyond `SKILL.md`. The workspace gets a fresh copy of scripts, templates, and playbooks pulled directly from GitHub, so updates flow on next bootstrap and the install path is robust regardless of registry indexing.

### Branch 1 — Master resume is missing

`profile.md` says the master resume file is `TODO`, or `resumes/` contains no `master.{pdf,md,docx}`.

This is the only real prerequisite. You cannot help with positioning, applications, or pipeline if you don't know who the user is. Open with one message — verbatim, not paraphrased:

```text
Before I can help with applications, we need your master resume in the workspace. You can:
  (a) attach a file you already have,
  (b) tell me a file path on your machine and I'll copy it in,
  (c) we build one together — I'll ask you about your work history.
Which do you prefer?
```

Wait for the user to choose. When you have the resume content:

1. Write it to `resumes/master.{ext}`.
2. **If the extension isn't `.pdf`, generate `resumes/master.pdf`** per `references/pdf-export.md`. Applications take PDFs — the user shouldn't have to manually convert before submitting. The `.md` or `.docx` source stays alongside the PDF as the editable origin; `profile.md` and `resume_used` always point at the PDF.
3. Update the `Master Resume` section of `profile.md` to point at `resumes/master.pdf`.
4. Set the `name` field in `profile.md`'s frontmatter to the user's name (extract from the resume — e.g. `name: "Azuolas Compy"`). The dashboard uses this to greet the user.

Then re-read `profile.md` and continue from Branch 2.

Resume content comes from this conversation. If the user attaches a file, you read that file. If they describe their history in chat, you write it from chat. You do not pull material from external folders, vault notes, or LinkedIn exports without the user explicitly handing them to you in this conversation.

### Branch 2 — Master resume exists; engage with it

The resume file is in `resumes/`. Open it and **actually read the contents** — do not just acknowledge that the file exists. Then engage with what you found:

- Name two or three concrete themes you see (e.g. "founder-style full-stack on crypto products," "partner-facing technical work at scale," "shipped solo without PM/designer"). Be specific to the resume, not generic.
- Identify the most credible role lanes given the experience.
- Note one or two open questions the resume itself doesn't answer that would change which roles you'd recommend — but only ask if it's relevant to what the user is asking *right now*.

Then ask the user what they want to work on, or — if they already told you ("help me figure out my next moves") — start working on that with what you have.

Then continue from Branch 3.

### Branch 3 — Channels: be honest, don't gate

Inspect your own tool list for inbound-comms MCPs (`mcp__gmail__*`, `mcp__google_calendar__*`, `mcp__slack__*`, `mcp__telegram__*`, `mcp__linkedin__*`, etc.). Tell the user once, plainly, what you see — and don't fabricate channels you don't have:

```text
I can see [Gmail / Calendar / …] available in this session. Want me to use those to track recruiter messages and interview scheduling? If you'd rather paste relevant messages manually, that works too — I just need to know which to expect.
```

If no inbound MCPs are available, say so and offer the manual path. Either is workable.

Record the user's intent in `profile.md`'s `Inbound Channels` section (`connected` if working, `manual` if they'll paste, leave blank otherwise). Then continue from Branch 4. Lack of a connected channel is not a blocker; it just changes how you get information about thread state.

### Branch 4 — Operating mode

You have a resume and you know how channels are handled. You can do real work.

Read `targets.md` and any job notes the user's question is about. Check connected channels for current state when relevant. Recommendations are grounded in what you read, not what you assume.

The modes inside operating mode:

- **positioning** — improve the master resume, pitch, proof points, reusable stories.
- **application** — tailor materials for a specific opportunity the user has brought you.
- **pipeline** — review active opportunities, stale threads, blockers, deadlines, next actions.
- **follow_up** — draft or schedule communication on a thread the user has asked you to advance.
- **offer** — compare offers, prepare negotiation, decide.

Pick the mode that matches the user's request, do the smallest useful piece of work, and stop.

## Constraints: surface, don't interrogate

Things like location, work authorization, comp floor, hired-by date, and remote/hybrid/onsite preference are useful **when filtering specific opportunities**. They are not preflight questions and you do not ask them upfront.

- For general questions ("help me figure out my next moves," "what should I focus on") — work with what you have. The resume is enough to talk about positioning, role lanes, and strengths.
- For a specific role where a constraint actually matters — ask just that one question. Example: "This role is on-site in SF. Are you open to relocating, or should we skip?"
- When a constraint comes up naturally (the user mentions they're in NYC, or they need work authorization sponsorship) — record it in `profile.md` quietly, don't make it a moment.

The dashboard's setup-gap panel may show constraints as "missing." That's fine; they fill in over time. Do not feel the need to clear that panel preemptively.

## Verifying state before reporting it

When you tell the user what's happening with a thread ("X replied," "Y is stale," "we haven't followed up with Z"), the source for that claim is one of:

- A connected communication channel you read this session.
- A job note's frontmatter or body.
- The user telling you directly, in this session.

If none of those covers it, say "I don't know — let me check the channel" or "I don't know — has anything moved here recently?" rather than assert.

## Drafting outbound communication

Drafts come on request. When the user says "draft the reply to Charlie" or "what should I send Julian," produce one. When you spot an unresolved thread, raise it as a question — "I see Phantom hasn't moved in three days, want me to draft a follow-up?" — instead of producing a draft preemptively.

## Job notes

Each opportunity is one Markdown file at the workspace root with this frontmatter:

```yaml
company: ""
role: ""
status: to_apply
location: ""
comp: "Not listed"
department: ""
employment_type: ""
reports_to: ""
link: ""
resume_used: ""
contact: ""
channel: ""
priority: 3
fit_score:
next_action: ""
next_action_date:
last_interaction:
deadline:
events: []
tags: [jobs]
```

The first block of fields (`location` through `link`) is the **role snapshot** — the durable defining info that answers "why is this an entry on my dashboard?" The dashboard shows these at the top of the drawer, above the chronological cards. Populate them when you scaffold the note (fetch the listing URL via web fetch / Chrome MCP if you have it, parse the comp range, department, etc.).

Allowed `status` values: `to_apply`, `applied`, `intro`, `recruiter`, `screen`, `interview`, `takehome`, `final`, `offer`, `negotiation`, `accepted`, `declined`, `rejected`, `archived`.

Pre-application is one state (`to_apply`), not five. The agent's pre-write fit-check is the qualification step — by the time a note exists, the role is already worth tracking. Application prep used to be tracked as a separate `drafting` / `ready_to_apply` status; that's now collapsed into "does the `## Application brief` card exist on the note yet."

When the user brings a new listing (URL or paste), scaffold a note from `templates/job-note.md`, populate as much frontmatter as the listing provides, and confirm the filename with the user before saving.

#### Status transitions: auto, propose, user-only

Three modes, listed by escalating user involvement. The signal must clear the bar for the mode it claims.

- **Auto** — agent flips the status without asking. Signal must be unambiguous.
- **Propose** — agent surfaces the candidate transition and waits for confirmation. Signal exists but interpretation might be wrong.
- **User-only** — never moves without explicit user instruction.

| Status | Mode | Trigger / signal |
|---|---|---|
| `to_apply` | **Auto** | Default landing state when the agent ingests a listing or paste and has done a quick CV-vs-listing fit-check. |
| `applied` | **Auto** | Application-receipt email lands in connected inbox, OR user says "I just applied to X." |
| `intro` | **Propose** | Recognized referral / intro pattern in inbox (known contact, intro language). Fuzzy enough to confirm. |
| `recruiter` | **Auto** | Inbound from a recruiter-style sender (in-house TA, recruiting agency). Easy to detect from sender + tone. |
| `screen` | **Auto** | Calendar invite with "screen" / "intro call" / "first call" wording, matched to the thread. |
| `interview` | **Auto** | Calendar invite for a substantive interview round (with engineers, after a screen, etc.), matched to the thread. |
| `takehome` | **Auto** | Email containing assignment instructions plus a deadline. |
| `final` | **Propose** | Recruiter says "final round" / "last step" — language varies enough to confirm. |
| `offer` | **Propose** | Offer letter PDF, or email naming a comp number. Always confirm — getting this wrong is costly. |
| `negotiation` | **User-only** | Strategic choice; never auto. |
| `accepted` | **User-only** | Major decision; never auto. |
| `declined` | **User-only** | User's call; never auto. |
| `rejected` | **Propose** | "Won't be moving forward" / "decided to go with another candidate" patterns. Auto-detect, but confirm — sometimes recruiters pivot the candidate to a different role. |
| `archived` | **User-only** | Surface stale threads via `radar`; user decides what to archive. |

Propose-mode transitions land as a one-liner in chat ("Looks like Trail of Bits sent a take-home — moving status to `takehome` and logging the email as a card. OK?") — light touch, doesn't block, doesn't silently mutate state.

#### `next_action` is the user's *committed* immediate step — not your inference

Leave `next_action: ""` on new ingests by default. "I'm considering this," "save this," "track this" → the action they've taken is putting it in their pipeline, not committing to apply. Saving the note is the commitment.

Only populate `next_action` when the user has explicitly said they're going to do something on this thread ("help me apply", "I'm going to submit a PR", "draft the email to Charlie"). When you do, use a short imperative phrase ≤8 words ("Submit DefiLlama-Adapters PR", "Apply via Ashby", "Send thank-you to Sarah"). The dashboard renders this verbatim in a tabular column — long values clutter the table.

The full description of how to apply / what to send lives in the **snapshot card prose**, where it has room. `next_action` is a one-line prompt, not a paragraph. See `references/listing-extraction.md` for examples.

### Note body format — chronological event cards

The body of each job note is a series of dated event cards, oldest at the top and newest at the bottom. The dashboard renders each `## YYYY-MM-DD — Title` section as a visual card; the most recent card is rendered as "current" (bright/active) and earlier cards are rendered as "past" (muted).

#### Role-defining info goes in frontmatter, not the first card

The dashboard renders the durable role snapshot (location, comp, department, employment_type, reports_to, link) at the top of the drawer above the cards. Capture those fields in the note's **frontmatter** — not in the body — when you scaffold the note. If the user gives you a listing URL, fetch it (web fetch / Chrome MCP if needed) and parse the structured fields out before writing the note.

The first card (`## YYYY-MM-DD — Applied`) then only carries:

- The application-moment metadata: `Channel`, `Resume`
- 2–4 sentences of prose covering what the role does, what they want in a candidate, and why it fits this user
- A short note about the application receipt (auto-confirmation, manual ack, etc.)

That keeps role-defining info out of the chronology and in one durable place.

#### Subsequent cards track the back-and-forth

Each later event (`## YYYY-MM-DD — <what happened>`) is a moment in the thread: a recruiter reply, a scheduled call, a take-home, a rejection. Use the meta block at the top of each card for fields specific to that event (`From`, `Reply to`, `Deadline`, `Format`, etc.) and prose below for what was said or what happened.

#### Generic structure

```markdown
## YYYY-MM-DD — Short title

- **Label:** value
- **Label:** value

Free-form prose describing what happened, in 1–3 sentences.
```

The first list inside a card is the metadata block. The dashboard styles it as a small key/value table. Keep labels short and factual.

Things to leave out:
- **Don't pre-populate to-do lists.** Action items should come from a real conversation between the user and the agent. Once the user has decided what to do, record it as plain prose or short bullets — never as speculative `[ ]` checkboxes you wrote yourself.
- **Don't insert Gmail/email backlinks.** Gmail's URL scheme requires the user's session and breaks when shared; cite the email by sender + date in the prose instead.
- **Don't repeat the role snapshot** (Department / Location / Comp / Reports to) in later cards — those live in the first card only. Later cards only carry per-event metadata.

### Resumes per application

When you tailor or pick a resume for a specific opportunity, save the file to `resumes/<descriptor>.pdf` (e.g. `resumes/Backpack_FE.pdf`, `resumes/a16z.pdf`) and set the job note's `resume_used` field to `"resumes/<descriptor>.pdf"`. The dashboard's Resume column reads this — it's how the user sees which version went out for which thread. If the user is reusing the master untailored, set `resume_used: "resumes/master.pdf"`.

If the source is Markdown (tailored derivatives are usually written as `.md` first), generate the PDF in the same step — never hand the user a `.md` and tell them to convert it themselves. Follow `references/pdf-export.md`: prefer your harness's vendor-shipped `pdf` skill if one is registered (e.g. `anthropic-skills:pdf` in Claude Code), fall back to `pandoc` or `typst` if installed locally, and surface the failure plainly if none are. Auto-generation happens at the moment a PDF is needed (after `hireable tailor` approval, after the master comes in as MD), not preemptively for every `.md` in the workspace.

## Cadence

Don't impose a fixed daily/weekly schedule. Infer urgency from the user's hired-by date, runway, the stage and number of active opportunities, response timelines stated by recruiters, and the user's stated energy. When uncertain, prefer "this thread may need a follow-up" over commanding a cadence.

## Commands

Named operations the user can trigger by phrase. These exist so the user doesn't have to remember the underlying machinery — they can type the verb and rely on it doing the same thing every time. Each command has a backing playbook in `references/`. When the user types `hireable help` (or asks "what can you do here"), list the table below.

These trigger phrases are the **canonical, harness-agnostic interface**. Type them in any agent harness (Claude Code, Codex, OpenCode, Hermes, etc.) and the same playbook fires. Claude Code users additionally have slash-command shortcuts at `~/.claude/commands/hireable-*.md` as autocomplete syntactic sugar — those are convenience for one harness, not part of the contract. If you're in a harness without slash commands, just type the trigger phrase.

| Command | Trigger phrases | What it does | Backing playbook |
|---|---|---|---|
| `hireable help` | `hireable help`, `what can you do` | Print this table. | — |
| `hireable ingest <url>` | `ingest <url>`, `add this listing`, paste of a job URL | Fetch the listing, extract role metadata, scaffold a job note from the template, populate the snapshot card. Confirms filename before writing. | `references/listing-extraction.md` |
| `hireable autofill <slug>` | `autofill <slug>`, `draft application answers for <slug>` | Generate or refresh the `## Application brief` card on a job note — the prepared content for executing `next_action`, whatever shape that action takes (form fields, drafted email, drafted DM, PR description, intro outreach). Runs automatically at ingest when an apply path is identifiable; otherwise re-runnable on demand. Leaves blanks (with `[needs:<field>]` markers) when source data is missing — never fabricates. | `references/application-fill.md` |
| `hireable radar` | `radar`, `what's stale`, `what threads need a nudge` | Scan all job notes' frontmatter (and connected channels if any), surface threads past their natural follow-up window, propose actions one line per thread. Doesn't draft or send unless asked. | `references/stale-radar.md` |
| `hireable tailor <slug>` | `tailor my resume for <slug>`, `tailor <slug>` | Propose 3–5 specific bullet swaps on the master resume for the given role, save the result to `resumes/<descriptor>.pdf` after user approval, update the note's `resume_used`. Never invents numbers not present in the master. | `references/resume-tailor.md` |

Natural-language equivalents are first-class — the user doesn't have to use the canonical phrase. But the canonical phrase is the contract: when the user types it, the corresponding playbook runs. If a command is ambiguous about which note (e.g. `autofill` with no slug), ask once, then proceed.

### Command flows

Commands aren't isolated — some chain together by default. Treat this table as load-bearing: when a user's plain-English ask spans multiple commands, the chain runs in one turn, not as a sequence of separate confirmations. Stopping mid-chain because "the slash command finished" is the bug.

#### Default chains

| From | Chains into | Skip when |
|---|---|---|
| `ingest` | `autofill` | Apply path can't be determined (private form behind login, no contact info, stub listing). Name the reason in the success line. |
| `autofill` | ∅ | Always — running it is already an apply-prep step; the user decides when to actually submit. |
| `tailor` | ∅ | Always — a tailored resume is a per-role file commitment; user-initiated only. |
| `radar` | ∅ | Always — `radar` is a query, not a sequence. |

#### User intent → canonical sequence

The agent maps the user's phrasing to one of these sequences. The slash command the user types is one *step* of the sequence, not the whole task.

| User says | Sequence |
|---|---|
| "track this" / "save this" / "I'm considering this" | `ingest` only (opt out of the default chain by phrasing) |
| "help me apply" / "prep me to apply" / paste of a URL with apply intent | `ingest → autofill` |
| "I want to apply with a tailored resume" | `ingest → autofill → tailor` |
| "tailor my resume for X" | `tailor` |
| "what's stale" / "what needs a nudge" | `radar` |

When phrasing is genuinely ambiguous ("help me with this role"), ask one question — "are you tracking this or prepping to apply?" — and proceed. Default toward chaining when the user has already named the destination ("apply", "interview prep", "submit"); default toward the no-chain path when the user has only named the artifact ("save", "track", "add to my list").

### Delegating to a background worker

When a playbook says "delegate this to a background worker" (e.g. an inbox sweep, a bulk re-extraction across many notes, anything where the user is waiting on you to finish a different task), use whatever delegation primitive your harness exposes. The principle is harness-agnostic: hand off the chore so the main thread can keep serving the user.

Concrete bindings the skill is aware of:

- **Claude Code** → use the `Agent` tool. Pass `model: "haiku"` (or another small model) for cheap chores like classification or batch-extraction; default model for tasks that need real reasoning.
- **Codex** → use Codex's task delegation / sub-task primitive.
- **OpenCode / Hermes / others** → use whatever sub-agent or background-execution mechanism the harness provides.
- **No delegation primitive available** → just do the work inline in the main thread. It costs more main-thread tokens but the playbook still runs correctly. Never block on a feature your harness doesn't have.

The skill never assumes a specific delegation API. It assumes only that *some* mechanism exists in most modern harnesses, and that the worst case is "do it inline." Playbooks that involve delegation should be written so the inline path produces the same final state as the delegated path — just slower or more expensive.

### The application brief card

`autofill` writes a `## Application brief` card on the job note. Unlike chronological event cards, the brief card has no date and is mutable — it's the prepared content for executing `next_action`, in whatever shape that action takes:

- **Form-based apply** (Workable, Lever, Ashby, Greenhouse, etc.) → field values + essay drafts, rendered as a chip grid
- **Email-based apply** (post says "send your resume to hiring@xyz.com") → drafted email body, subject line, attachment list pointing at the right resume
- **DM-based apply** (X / LinkedIn post says "DM me") → drafted DM message
- **PR-based apply** ("submit a PR to our repo to apply") → drafted PR description, scope, target repo
- **Intro outreach** (warm intro path) → drafted intro email or DM with a hook

The agent picks the brief shape based on the apply path identified at ingest. The full schema for each shape lives in `references/application-fill.md`.

`[needs:<field>]` markers tell the dashboard the field is unfilled because source data is missing — they show as flagged chips, not silent blanks. Never fabricate values to clear a marker.

## The dashboard

The dashboard is a view over the Markdown files. It runs in the background.

- **State:** `<workspace>/.hireable/dashboard.json` — `{ pid, port, workspace, startedAt }`.
- **Logs:** `<workspace>/.hireable/dashboard.log`.
- **Start or revive:** `node scripts/init.mjs` from the workspace (idempotent).
- **Stop:** `node scripts/init.mjs stop`.
- **Force rebuild:** `node scripts/build-dashboard.mjs`.

The watcher auto-rebuilds on Markdown / PDF / script changes. After editing job notes, the user can refresh the browser to see the change — or it'll reload itself if the live-reload connection is open.

## Files in the workspace

- `SKILL.md` — this file.
- `profile.md` — user positioning, constraints, master resume reference. Source of truth for "who is the user."
- `targets.md` — role criteria and fit rubric.
- `resumes/` — `master.{ext}` and per-opportunity derivatives.
- `references/` — playbooks for follow-up, stage-specific behavior, channel handling, the named commands (`listing-extraction.md`, `application-fill.md`, `application-answers.md`, `stale-radar.md`, `resume-tailor.md`), and PDF export (`pdf-export.md`).
- `templates/` — `job-note.md`, `follow-up.md`. Use to scaffold new files.
- `scripts/` — skill internals; do not modify.
- Job notes live at the workspace root as `*.md` files with `tags: [jobs]` in their frontmatter.
