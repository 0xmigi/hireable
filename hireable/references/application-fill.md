# Application Fill Playbook

Backs the `hireable autofill <slug>` command. Generates the `## Application brief` card on a job note — the prepared content the user needs to actually execute the application's `next_action`, in whatever shape that action takes.

## Goal

The user opens their job note and has everything they need to act, in the shape the apply path requires. Not a generic template. Not phantom questions. The brief matches the apply path the listing actually demands.

## Apply paths, and what the brief looks like for each

Identify the apply path before generating brief content. The path determines the brief shape; the path is identifiable from the listing source the agent already parsed at ingest.

| Apply path | Signal at ingest | Brief shape |
|---|---|---|
| **Form-based** | Listing on Workable / Lever / Ashby / Greenhouse / Gem / direct careers page with an Apply button | Field values + essay drafts mapped to the real form fields |
| **Email-based** | Post or listing says "send your resume to <email>" / "email <person> at <addr>" | Drafted email (subject + body), attachment list pointing at the right resume |
| **DM-based** | X or LinkedIn post says "DM me" / "reply to apply" | Drafted DM message, plus the resume to share if asked |
| **PR-based** | Listing says "to apply, submit a PR to <repo>" or similar | Drafted PR description, suggested scope, target repo |
| **Intro outreach** | Warm-intro path (someone forwarded the role; user wants to reach the contact) | Drafted intro email or DM with a hook tying user to the role |

If a listing offers multiple apply paths (e.g. "fill the form OR DM me"), prefer the formal one and note the alternative in the brief.

## Form-based: fetch the actual application form

For the form-based path, fetch the application form before generating brief content. The brief schema comes from the form's real fields. The values come from `profile.md` and `references/application-answers.md`.

### How to find the form URL

| Board | Form URL pattern |
|---|---|
| **Ashby** | `<listing-url>/application` (e.g. `jobs.ashbyhq.com/spruceid/<id>/application`) |
| **Lever** | `<listing-url>/apply` |
| **Workable** | Same URL as the listing — the form is on the page below the description |
| **Greenhouse** | Look for `<iframe src="https://boards.greenhouse.io/embed/job_app?for=<co>&token=<id>">` on the listing page, or the "Apply for this job" button's `href` |
| **Gem** | "Apply" button links to a board listed above (Greenhouse, Lever, etc.) — follow it |
| **Direct careers page** | Click the "Apply" link, follow to the next page (may be a custom form, may redirect to a board) |

Use `WebFetch` first. If the form is rendered client-side (Ashby, Greenhouse iframes, some Workdays), fall back to the Chrome MCP and parse the rendered DOM.

### What to parse

For each form field, capture:
- **Label** (e.g. "Phone Number", "Desired Salary", "Visa")
- **Required flag** (look for `required`, `aria-required="true"`, or the red `*` indicator)
- **Type** (text / email / textarea / select / radio / file)
- **Helper text or sublabel** (e.g. "What is your target cash compensation range?")

### How to handle file-upload fields

Forms often have a "Resume" file input. The brief shouldn't try to "fill" that with a path — instead, surface the resume the user is using for this opportunity (`resume_used` from the job note's frontmatter) so they know which PDF to attach. Render as a chip with label "Resume" and value pointing at the resume filename.

### When the form can't be fetched

If the form is behind login (LinkedIn Easy Apply), inside an applicant tracking system that requires JS we can't run, or the URL pattern doesn't match: tell the user plainly, then fall back to a minimal canonical brief (Identity from profile + 1–2 essay slots for cover-letter content). Mark the brief as `(generic — couldn't fetch SpruceID's form, may not match)` so the user knows to verify against the real form before submitting.

## Email-based: draft the actual email

When the apply path is email, the brief contains a ready-to-send email plus the attachment list. Subject line, recipient, body, and the resume filename. Pull the recipient address from the listing verbatim — don't normalize, don't infer.

```markdown
## Application brief

> Apply path: email to hiring@example.com, per the listing on 2026-05-04.

### Email
- **To:** hiring@example.com
- **Subject:** Software Engineer application — Azuolas Compy
- **Attachment:** resumes/Example_SWE.pdf

### Body
> Hi <name if known, else "team">,
>
> <2–3 paragraph drafted email body grounded in the role snapshot and the user's master resume. Lead with one sentence on the fit, one sentence on the most relevant proof point, one sentence with a clear ask.>
>
> Best,
> Azuolas
```

The `### Body` section uses a `>` blockquote so the dashboard renders the full text (not truncated as a chip). Don't use `### Cover letter / additional information` here — that section name is reserved for form fields and triggers a different render mode.

## DM-based: draft the message

When the apply path is a DM (X, LinkedIn, Telegram), the brief contains the drafted message plus the handle. Short — DMs are not cover letters.

```markdown
## Application brief

> Apply path: DM @D3VINE2026 on X, per the post on 2026-05-04.

### DM
- **To:** @D3VINE2026 (Devine)
- **Platform:** X

### Message
> <2–4 sentence drafted DM. Lead with the role and where you saw it, one specific reason for the fit, then a clear ask (e.g. "happy to share my resume — open to a 15-min call?").>
```

## PR-based: draft the contribution

When the apply path is a PR to a repo, the brief contains the proposed scope and a drafted PR description. The user still has to write the code — the brief just gets them ready.

```markdown
## Application brief

> Apply path: submit a PR to defillama/DefiLlama-Adapters, per the listing on 2026-05-04.

### PR target
- **Repo:** defillama/DefiLlama-Adapters
- **Suggested scope:** <one concrete task — e.g. "add an adapter for protocol X" — grounded in the repo's contributing docs if findable, otherwise the user's own area of expertise>

### PR description draft
> <Drafted PR title + body, in the format the repo expects. Reference the listing if appropriate.>

### Follow-up
- **After PR opens:** email <hiring contact> with the PR link + a 1-sentence note on the role
```

## Intro outreach: draft the reach-out

When the path is a warm intro through a contact, the brief contains the drafted intro message plus the hook tying the user to the role.

```markdown
## Application brief

> Apply path: reach out to <contact name> for a warm intro, per <forwarder> on 2026-05-04.

### Intro message
- **To:** <contact name>
- **Channel:** email / DM
- **Hook:** <one sentence on why this person would care — shared connection, shared interest, etc.>

### Body
> <2–3 paragraph drafted message. Specific to the contact, not boilerplate.>
```

## Output: the Application brief card

Write a `## Application brief` card on the job note. Located after the snapshot card. Mutable — re-running `autofill` overwrites it.

### Required format — list, not table

**This format is mandatory. The dashboard parser only renders briefs in this exact shape — markdown tables, paragraphs, or any other format will not render and the user will see an empty drawer.**

The brief is structured as: optional `>` blockquote noting the source form, then one or more `### Section` headings, each followed by a list where every line is `- **Label:** value`. Nothing else. No tables. No extra prose. No checkboxes.

Use this template literally — copy the structure, fill in the values:

```markdown
## Application brief

> Built from the application form at <form-url> on YYYY-MM-DD.

### Form fields
- **Full Name:** Azuolas Compy
- **Email:** azuolascompy@gmail.com
- **Phone Number:** (425) 491-0272
- **Current Company:** Moment
- **Location:** New York, NY
- **LinkedIn URL:** linkedin.com/in/azuolas-compy
- **Github URL:** github.com/0xmigi
- **Desired Salary:** $120K base
- **Visa:** No
- **If yes, please describe:** —

### Cover letter / additional information
- **Additional Information:** [needs:cover_note]

### Resume
- **File to attach:** resumes/SpruceID_FS.pdf
```

Section names should mirror what the form actually has:

- **`### Form fields`** — short identity / logistics fields. The catch-all default. Renders as a chip grid.
- **`### Cover letter / additional information`** — for textarea fields like "Additional Information", "Cover letter", "Written response". Renders as stacked essay cards with full text visible (so paragraph-length content isn't truncated). Use this section name **literally** — the dashboard uses it to switch render modes.
- **`### Resume`** — for the file-upload field. One chip pointing at `resume_used`.

Don't encode required-ness in the brief. No `*` suffixes on labels (it breaks markdown bold rendering). No "Required" columns. No status indicators per row. Required-ness is something the user can read off the actual form; the brief is just a copy-source. Keep the format clean: `- **Label:** value` and nothing else.

If a form field maps to a value in `application-answers.md`, use that value verbatim. If not, mark `[needs:<field>]`.

The agent should match form labels to answer-library keys generously: "Phone Number" → `phone`, "Github URL" → `github`, "Desired Salary" → `comp_floor` or `comp_expectation`, "Visa" → `visa_sponsorship`. Don't be rigid — if the form asks "Are you authorized to work in the US?" that maps to `us_work_authorization` even though the wording differs.

### What not to do

- Don't render the brief as a markdown table. The parser doesn't handle tables.
- Don't append `*` (or any other character) to labels to indicate required. It breaks the markdown bold rendering and the field will silently disappear from the dashboard.
- Don't include a "Required" column or any per-field status column.
- Don't include conversational prose between sections ("here's what's filled, here's what's missing"). The brief is a clean output, not a transcript.
- Don't include `[ ]` checkboxes or to-do lists. The brief isn't a task list.
- Don't add commentary at the bottom of the brief ("you should write a cover letter because..."). If you have advice, say it in chat after writing the file.

## Filling rules

- **Reusable answers** (most identity, logistics, generic essays) come verbatim from `profile.md` or `application-answers.md`. Don't paraphrase — the user wrote them in their voice.
- **Role-specific content** (cover letter prose, "why this company", "why this role" answers if the form asks) is short and grounded in the role snapshot. 1–2 sentences for a chip-sized answer; up to 1–2 paragraphs for a cover-letter field. Don't write three paragraphs for a 200-character field.
- **Missing data** → `[needs:<key>]` marker, never a guess. The dashboard renders these distinctly so the user can see what's still blank.
- **Demographic fields** are never auto-filled. If the form asks them, render the chip with no value and a note: "Skipped — fill at submission if you choose to."
- **Never invent**: employers, dates, projects, metrics, or links not present in the source. If a strong essay would need a number not in the master resume, ask the user once before writing it.

## Triggering

- **At ingest (default):** `hireable ingest` chains into autofill once the apply path is identifiable. The agent writes the brief in the same step it scaffolds the note. This is the path most users see.
- **Direct (re-runnable):** `hireable autofill <slug>`, `autofill <slug>`, `draft application answers for <slug>` — overwrites the existing brief. Use when the form has changed, the apply path has changed (e.g. an X post was followed up with an email), or the user wants a fresh pass.
- **Skip-at-ingest cases:** if the apply path can't be determined from the listing (private form behind a login, no contact info, listing is a stub), scaffold the note without a brief and tell the user. The user re-runs `autofill` later when they have the missing detail.

If the slug is ambiguous, list candidates and ask. If only one note has `status: to_apply` and no brief, default to that.

## Scaffolding `application-answers.md`

If the file doesn't exist:

1. Create it with the structure documented in `references/application-answers.md` (template).
2. Pre-fill identity + logistics from `profile.md` where possible (name, email, location, links — anything already known).
3. Leave the essay sections empty.
4. Tell the user: "I scaffolded `references/application-answers.md` from your profile. Want to fill in the reusable essay answers now, or wait until they come up in a real application?"

## What this command doesn't do

- Doesn't submit anything.
- Doesn't fill fields the user must verify (demographic, sometimes-changing things like "expected start date" depending on submission timing).
- Doesn't tailor your resume — that's `hireable tailor`.
- **Doesn't reflexively offer to tailor after writing the brief.** The default for most roles is `master.pdf`; tailoring is the exception, not the rule. Only chain into `tailor` if the user explicitly asks ("tailor my resume too", "with a tailored resume"). When the brief lands, set `resume_used: "resumes/master.pdf"` on the note and stop — don't ask "want me to run tailor?" reflexively.
- Doesn't produce a generic brief when a real form was fetchable. Quality > template completeness.
