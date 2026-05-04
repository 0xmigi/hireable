# Listing Extraction Playbook

Backs the `hireable ingest <url>` command. Triggers also when the user pastes a job URL with intent to track.

## Goal

URL → fully populated job note in one shot. The user sees the file and the dashboard card, not the extraction process.

## Steps

1. **Fetch the listing.** Prefer `WebFetch` for static job pages. If the page is rendered client-side or behind a soft block, fall back to the Chrome MCP. Workable / Lever / Ashby / Greenhouse / Gem are all static enough for `WebFetch`.
2. **Extract per the schema below.** Read the full HTML and identify each field. If a field genuinely isn't on the page, leave it blank — never guess. Salary "Not listed" is a real and common answer.
3. **Identify the apply path.** Form-based / email / DM / PR / intro — see `references/application-fill.md` for the signal patterns. The path determines whether autofill can run at ingest.
4. **Choose the filename.** Pattern: `<Company> - <Role>.md` at the workspace root. Match the casing of how the company writes its own name. Confirm the exact filename with the user before writing.
5. **Scaffold from `templates/job-note.md`** and populate frontmatter + the first card. Status defaults to `to_apply`.
6. **Chain into autofill.** If the apply path is identifiable (form URL fetchable, email address present, DM target known, repo named, etc.), run the autofill playbook in the same step and write the `## Application brief` card. If it isn't (private form, no contact, stub listing), skip and tell the user — they can re-run `autofill` later when they have the missing detail.
7. **Don't pre-populate later chronological cards.** Only the snapshot/Applied card. Subsequent cards track real events.

## Output schema

Frontmatter fields the playbook fills (others stay default):

- `company` — exact public name
- `role` — exact title from the listing
- `location` — string as posted; if remote, prefer "Remote (US)" / "Remote (global)" with the policy from the listing
- `comp` — `"$X – $Y"` or `"Not listed"`. Don't translate equity into salary.
- `department` — only if the listing names one
- `employment_type` — `full-time` / `contract` / `fellowship` / `internship` / `part-time`
- `reports_to` — only if disclosed
- `link` — the canonical listing URL (strip tracking params)
- `channel` — the board (`Workable`, `Lever`, `Ashby`, `Greenhouse`, `Gem`, `Direct`, `Referral`)
- `next_action` — **leave empty (`""`) by default for new ingests.** See the "Setting `next_action`" section below. Don't populate this just because the listing has an apply method.

First card body:

```markdown
## YYYY-MM-DD — Applied

- **Listing:** <link>
- **Channel:** <board>
- **Department:** <if present>
- **Location:** <as posted, plus remote/hybrid/onsite>
- **Employment:** <type>
- **Reports to:** <if present>
- **Comp:** <range or Not listed>
- **Resume:** [needs:resume_used]

(2–4 sentences: what this role does, what they want in a candidate, why it fits this user. Pull from the listing prose plus profile.md positioning.)
```

If the user hasn't actually applied yet, title the card `## YYYY-MM-DD — Listing` and set `status: to_apply`. The `Applied` card is reserved for the actual application moment.

## Per-board hints

Boards bury the same fields in different places. When extraction quality matters:

- **Workable** — comp is in the JSON-LD `<script type="application/ld+json">` block at the top of the page; location is in the `<h2>` near the apply button. Department lives in the breadcrumb.
- **Lever** — comp rarely on the listing; check the `Additional Information` section. Department is in the URL slug (`/<dept>/<role>`).
- **Ashby** — comp and location are in the right-rail sidebar. `Reports to` is sometimes in the description prose, not a field.
- **Greenhouse** — comp is often in a dedicated "Compensation" heading near the bottom. Department in the URL.
- **Gem** — listing pages are minimal; the role description usually has the meat. Comp rare.
- **Direct careers pages** — most variable; read the whole thing rather than pattern-matching.

## Non-standard listings — X, LinkedIn, Telegram, forwarded posts

A meaningful chunk of crypto/startup roles surface as social-media posts instead of formal listings. They are unstructured prose, often very short, and the apply method is usually "DM me" or "email me" rather than a form. The skill should handle these gracefully — leave structured fields blank rather than guess, and capture the apply path explicitly.

### X (formerly Twitter) posts

URL pattern: `x.com/<user>/status/<id>` or `twitter.com/<user>/status/<id>`. Both forms work — don't normalize, just keep the URL the user gave you in the `link` field.

X is fully client-side rendered and frequently auth-walled. Use the Chrome MCP, not WebFetch. The user usually has X open in another tab and is logged in, so reads work.

What to extract from the page:

- **Author handle** (e.g. `@D3VINE2026`) and display name — capture both. The author is your `contact` and likely your apply target.
- **Author bio** — often names the company they work at ("eng @company") or links to it. This is your best hint at the `company` field if the tweet itself doesn't name one.
- **Post body** — the tweet text. Extract role title, any comp hint, any location/remote signal, any tech-stack hint, and the apply method. Most of these will be missing from any given post — that's normal.
- **Thread / quoted tweet** — replies and quoted tweets often hold the apply method ("DM for details" → "filled the role / still hiring / reply to apply"). Read at least the first few replies, especially from the original author.
- **Apply method** — almost always one of: DM the author, email an address mentioned in the post, fill a linked form, or reply to the tweet. Capture it verbatim in the snapshot card so the user knows exactly how to act.

What to leave blank rather than guess:

- `comp` — unless the post literally states a number or range. "competitive comp" is not a number; leave as `Not listed`.
- `location` — unless explicitly stated. Don't infer from author's stated location.
- `department` — almost never applicable to startup tweets.
- `employment_type` — only fill if the post says "full-time" / "contract" / etc. Don't default.
- `reports_to` — leave blank; tweets rarely include this.

Frontmatter values that should be set:

- `channel: "X"` (or `"Twitter"` if the user prefers)
- `link: <full tweet URL>`
- `contact: "@<handle> (<display name>)"` — both, separated, so the user has the @-handle for DM and the name for context

Snapshot card body should explicitly note the apply method as its own line in the meta block:

```markdown
- **Apply via:** DM @D3VINE2026 on X
```

Then 1–2 sentences of prose summarizing what the role is, what they want, why it fits — same as any other listing, just shorter because the source is shorter.

### LinkedIn posts

Auth-walled. Chrome MCP only, and only if the user has LinkedIn open. Same shape as X: capture author, role gist, apply method (usually "comment to apply" or "DM me"). Set `channel: "LinkedIn"`.

### Telegram channel / Discord channel / Slack post

These usually arrive as either a screenshot or pasted text from the user, not a URL the agent can fetch. When the user pastes message content, treat the paste as the source, ask for the channel name (so `channel:` can be set correctly), and ask for the apply target if it's not obvious from the paste.

### Forwarded / warm-intro listings

Someone forwarded the user a role via DM or email. The user pastes context. Same handling as a manual paste: capture the forwarder as `contact`, capture the original source URL if present, and explicitly note in the snapshot card that this is a warm-intro path (it changes how the user should reach out).

### What to do when the source doesn't have a "listing URL"

Set `link: ""` and capture the full post text (or paste) inside the snapshot card under a `### Source` subheading. The note becomes self-contained — the user can re-read the original later without chasing dead tweets.

## Setting `next_action`

The `next_action` frontmatter field shows up verbatim in the dashboard's `Next action` column. It is the user's *committed* immediate next step on this thread — not a suggestion, not "what would normally come next," and not the listing's stated apply method copied into a cell.

**Default for new ingests: empty (`""`).** When the user says "I'm considering this role," "save this," "track this," "thinking about it" — the action they've taken is *putting the thread in their pipeline*, not *committing to apply*. Saving the note is the commitment. Leave `next_action` blank so they can decide later.

**Populate only when the user has explicitly committed to acting**, e.g.:
- "Help me apply for this" / "let's tailor my resume for this" → `next_action: "Apply"` or `"Tailor resume"`
- "I'm going to submit a PR to DefiLlama" → `next_action: "Submit DefiLlama-Adapters PR"`
- "Draft the email to Charlie" → `next_action: "Send Charlie email"`

**Format: short imperative phrase, ≤8 words.** It's a tabular column, not a paragraph. Long values clutter the dashboard.

- ✓ `"Submit DefiLlama-Adapters PR"`
- ✓ `"Apply via Ashby"`
- ✓ `"Send thank-you to Sarah"`
- ✗ `"Submit a PR to DefiLlama-Adapters, then email hiring@defillama.com with PR link, work history, and reasons for joining"` — that prose belongs in the snapshot card, not in `next_action`

The full description of how to apply / what to send / where the listing wants you to go lives in the **snapshot card body**, where it has room to breathe. `next_action` is a one-line prompt for the user, nothing more.

**When to update later:** once the user has done the current `next_action` (applied, sent the email, did the take-home), update it to the *next* committed step — or clear it back to empty if there isn't one yet. Don't leave stale next-actions sitting on the note.

## Fast-path: skip confirmation when extraction is unambiguous

For recognized job boards (Workable / Lever / Ashby / Greenhouse), if **all** of the conditions below are met, skip the confirmation prompt and write the file directly. The user is paying for the skill to be fast — every avoidable round-trip is friction.

Fast-path conditions (all must hold):

- Source is a known job board, not a social post or paste
- `company` extracts cleanly (matches the page's branded name)
- `role` matches the posted title verbatim — no Senior/Junior/Lead modifier in the description that contradicts the title
- `location` is clearly stated (single value, or explicit remote policy)
- `comp` is either a real range from JSON-LD / the page, or unambiguously "Not listed" (no "competitive" / "DOE" / "negotiable" phrasing)
- The filename `<Company> - <Role>.md` does not collide with an existing note for a different version of this role

When all conditions hold, write the file directly, then chain into autofill (per step 6 above) without pausing, then output a **single-line success message** covering both steps:

```
Wrote `SpruceID - Full-Stack Software Engineer.md` + brief ✓ — view in dashboard.
```

If the brief was skipped because the apply path wasn't determinable (private form, no contact info, stub listing), name the reason in parens:

```
Wrote `SpruceID - Full-Stack Software Engineer.md` ✓ (brief skipped: form requires login) — view in dashboard.
```

Don't preview values. Don't paste the snapshot card. Don't echo the frontmatter. Don't stop after the file write and ask whether to autofill — chain into it. The dashboard is the surface for verifying what landed; the chat just confirms the action.

Always fall back to the standard confirmation step (below) when:
- Source is a social post (X / LinkedIn — unstructured by nature, deserves user eyes)
- `comp` uses vague phrasing
- Title has modifiers in the description that don't match the posted title (Senior vs. plain title)
- Multiple locations listed (need to pick primary)
- A note for the same company + similar role already exists (might overwrite)
- Anything else the agent finds genuinely ambiguous

## Confirmation step

Before writing the file, show the user the values you're about to commit:

```
Filename: <Company> - <Role>.md
Comp: <extracted or "Not listed">
Location: <extracted>
Status: to_apply
Next action: <value or "(empty — you said you're considering, not committing)">
Going to scaffold the note. OK?
```

The `Next action` line is mandatory in this preview. If you populated `next_action` with anything beyond `""`, show it explicitly so the user can correct an over-eager value before the file lands. If you left it blank because the user only said "I'm considering this" / "save this," call that out — it tells the user the field is blank by design, not by oversight.

If anything was ambiguous (e.g. the listing said "competitive" for comp, or the location was a list, or you weren't sure whether to populate `next_action`), surface it here and let the user resolve it. Don't just write and ask forgiveness.

## What not to do

- Don't fabricate a `Reports to` if the listing doesn't say. Leave blank.
- Don't normalize the role title ("Software Engineer 2027 New Grads" stays as-is).
- Don't write speculative `[ ]` checklist items in the card body.
- Don't pre-fill `resume_used` — that's set when the user actually picks a resume for this app.
