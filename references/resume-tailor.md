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

- **Propose 3–5 swaps. Not 10. Not 1.** Resume tailoring has diminishing returns — the top 3–5 highest-leverage changes are what matter. Surface them and stop.
- **Each proposal is a one-for-one swap**, not an addition. The master has a fixed length the user has chosen; tailoring shifts emphasis, not size. If the user wants a fresh bullet, they'll say so.
- **Never invent metrics.** If the existing master bullet says "shipped a real-time pipeline," the tailored version can sharpen it ("shipped a real-time WebRTC + on-chain state pipeline") but cannot add "serving 10k users" if that number isn't already documented in `profile.md` or master. Ask before adding any number.
- **Tailoring is reordering and emphasis, not fabrication.** Use the same employers, dates, and projects. Re-language them for relevance.
- **Don't propose swaps that make the bullet less true.** If the master says "evaluated 50+ grants" and the role wants product judgment, the tailor can lean into the judgment angle without dropping the number.

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

## When master is missing or thin

If `resumes/master.{ext}` doesn't exist, do not tailor. Redirect to Branch 1 of the main flow: get the master in place first.

If the master exists but the bullets are too generic to tailor (no concrete projects or metrics), tell the user the master needs strengthening first and offer to switch to `positioning` mode.
