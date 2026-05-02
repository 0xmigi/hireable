---
description: Generate or refresh the Application brief card from the actual application form
argument-hint: <slug or company name>
---

Activate the hireable skill and run `hireable autofill` for the target below. Follow `references/application-fill.md`.

**Critical first step**: don't generate a brief from a generic template. Fetch the **actual application form** (not just the listing) and parse its real fields. Form URL conventions:

- Ashby: `<listing-url>/application`
- Lever: `<listing-url>/apply`
- Workable / Greenhouse / direct: see the playbook for patterns

Use WebFetch first; fall back to the Chrome MCP if the form is rendered client-side. Parse field labels, required flags, helper text. Build the brief schema from the form, not from a checklist of common application fields.

Then fill values from `profile.md` and `references/application-answers.md`. Use `[needs:<key>]` for any value missing from source data. Never fabricate.

If the form genuinely can't be fetched, fall back to a minimal canonical brief and **clearly mark** the brief as generic so I know to verify against the real form before submitting.

If `references/application-answers.md` doesn't exist yet, scaffold it first per the playbook.

If the target below is empty, list the currently-drafting job notes and ask which one I mean.

Target: $ARGUMENTS
