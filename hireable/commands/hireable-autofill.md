---
description: Generate or refresh the Application brief card — the prepared content for executing next_action
argument-hint: <slug or company name>
---

Activate the hireable skill and run `hireable autofill` for the target below. Follow `references/application-fill.md`.

The brief is the prepared content for executing the role's `next_action`, in whatever shape the apply path requires:

- **Form-based** (Workable / Lever / Ashby / Greenhouse / Gem / direct careers) → fetch the *actual application form*, not just the listing. Form URL patterns: Ashby `<listing>/application`, Lever `<listing>/apply`, Workable inline, Greenhouse iframe `for=<co>&token=<id>`. WebFetch first; fall back to Chrome MCP for client-rendered forms. Parse real field labels and helper text — don't generate from a generic checklist.
- **Email-based** (post says "email <address>") → drafted email subject + body + attachment line.
- **DM-based** (X / LinkedIn post says "DM me") → drafted DM message.
- **PR-based** (listing wants a PR to a repo) → drafted PR description + suggested scope.
- **Intro outreach** (warm-intro path) → drafted intro message with a hook.

Fill values from `profile.md` and `references/application-answers.md`. Use `[needs:<key>]` for any value missing from source data. Never fabricate.

If the form genuinely can't be fetched, fall back to a minimal canonical brief and **clearly mark** it as generic so I know to verify against the real form before submitting.

If `references/application-answers.md` doesn't exist yet, scaffold it first per the playbook.

If the target below is empty, list job notes that don't have an `## Application brief` card yet and ask which one I mean.

Target: $ARGUMENTS
