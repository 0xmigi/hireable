# Resume Tailor Playbook

Backs the `hireable tailor <slug>` command. Proposes targeted bullet swaps on the master resume for a specific role, then saves a new derivative file and updates the job note's `resume_used`.

## Goal

User opens a job note, runs `hireable tailor <slug>`, sees 3–5 specific swap proposals with rationale, approves or edits, and ends up with `resumes/<descriptor>.pdf` linked from the note. No "improve my resume" abstractions — every proposal is grounded in this specific role.

## Inputs

1. `resumes/master.{md,docx,pdf}` — the source bullets. If only PDF exists, read its text.
2. The target job note's snapshot card — what the role actually does, what they want.
3. `profile.md` positioning section — strengths, proof points, stories.

## Output

A diff-style proposal printed in chat:

```
Tailoring resumes/master.pdf for <Company> – <Role>:

[1] Section: Experience > Moment
    Master:    <existing bullet text>
    Tailored:  <proposed bullet text>
    Why:       <one phrase grounded in the snapshot — e.g. "they want production
               experience with on-chain state, this surfaces it">

[2] ...
```

After user approval (`approve`, `looks good`, `proceed`) or per-bullet edits:

1. Apply the swaps to a new file: `resumes/<descriptor>.md` where `<descriptor>` is short and recognizable (`Backpack_FE`, `a16z_FDE`, etc.). Confirm the descriptor with the user before writing.
2. **Generate the PDF.** Follow `references/pdf-export.md` — try the `pdf` skill first, then `pandoc`, then `typst`. The deliverable is `resumes/<descriptor>.pdf` alongside the `.md`. If conversion fails, surface that plainly per the playbook; don't silently leave the user with only an `.md`.
3. Update the job note's `resume_used` field to `"resumes/<descriptor>.pdf"` (or `.md` if conversion genuinely couldn't happen).

## Rules

- **The default is 0 swaps. Tailoring is the exception, not the rule.** Most masters cover most roles — that's what makes them masters. Before drafting any swap, do an honest scan: what does this role *specifically* ask for that the master doesn't already name? If the answer is "nothing meaningful," recommend `master.pdf` and stop. See *When tailoring isn't worth it* below.
- **A swap must change which concept is on the page, not just the wording.** "Built" → "shipped", "real-time pipelines" → "mission-critical real-time pipeline", "made decisions" → "owning decisions" — that's synonym shuffling. Skip it. The bar to clear: the swap surfaces a keyword, project, or angle the master doesn't already cover.
- **Cap at 3 swaps. 0–2 is normal.** If you find more than 3 genuinely-substantive swaps, the master is thin for this role family — the right move is `positioning` mode (strengthen the master), not `tailor` (mask the gap on one role).
- **Each proposal is a one-for-one swap**, not an addition. The master has a fixed length the user has chosen.
- **Never invent metrics.** If the existing master bullet says "shipped a real-time pipeline," the tailored version can sharpen it ("shipped a real-time WebRTC + on-chain state pipeline") but cannot add "serving 10k users" if that number isn't already documented in `profile.md` or master. Ask before adding any number.
- **Tailoring is reordering and emphasis, not fabrication.** Use the same employers, dates, and projects.
- **Don't propose swaps that make the bullet less true.** If the master says "evaluated 50+ grants" and the role wants product judgment, the tailor can lean into the judgment angle without dropping the number.

## When tailoring isn't worth it

If the master already names the keywords, projects, and angles the role asks for, say so plainly and stop:

> "Your master already covers what *<Company>* asks for — Solana production, on-chain state, real-time pipelines, founder shipping solo. No tailoring needed; attach `master.pdf`."

Then update the note's `resume_used` to `resumes/master.pdf` and exit. **Don't draft synonym swaps to fill the slot — that's bloatware behavior.**

This is the right answer surprisingly often. A well-built master is engineered to cover most roles you target. If `tailor` rarely produces real swaps, the master is doing its job — that's a signal of quality, not a problem to solve.

## Choosing the descriptor

Conventions, not laws:

- Single-word company + role family: `Backpack_FE.md`, `Phantom_FS.md`, `a16z_FDE.md`.
- Multi-word company: use the shortest distinctive token (`tools_for_humanity` → `TFH`).
- If the company already has a tailored file, version it: `Backpack_FE.md` → `Backpack_FE_v2.md`.

Confirm the descriptor with the user once before writing.

## What this command doesn't do

- Doesn't rewrite the master — only produces a derivative. Master changes are a separate `positioning` mode conversation.
- Doesn't generate a cover letter — that's drafting, separate ask.
- Doesn't fill the application brief — that's `hireable autofill`.
- Doesn't critique the master ("this bullet is weak"). Tailoring is in service of one specific role, not general resume coaching.
- Doesn't push edits when the master already fits the role. The honest answer is "use master.pdf"; deliver it without ceremony.

## When master is missing or thin

If `resumes/master.{ext}` doesn't exist, do not tailor. Redirect to Branch 1 of the main flow: get the master in place first.

If the master exists but the bullets are too generic to tailor (no concrete projects or metrics), tell the user the master needs strengthening first and offer to switch to `positioning` mode.
