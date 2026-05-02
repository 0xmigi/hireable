---
description: Propose targeted resume bullet swaps for a specific role
argument-hint: <slug or company name>
---

Activate the hireable skill and run `hireable tailor` for the target below. Follow `references/resume-tailor.md`: read `resumes/master.{md,docx,pdf}` plus the target job note's snapshot card, propose 3–5 specific bullet swaps with rationale grounded in the role, and wait for my approval before writing anything. Never invent metrics not present in the master.

After I approve:

1. Save the tailored markdown to `resumes/<descriptor>.md` (confirm the descriptor with me).
2. **Generate the PDF via your harness's vendor-shipped `pdf` skill if one is registered** (e.g. `anthropic-skills:pdf` in Claude Code, or any equivalent in another harness). Per `references/pdf-export.md`, this is the path that produces presentable output — don't default to `pandoc`/Chrome-headless if a vendor pdf skill exists.
3. If no vendor pdf skill is available in this harness, follow the rest of `pdf-export.md`'s priority chain (pandoc + xelatex, then typst, then surface the failure with install options).
4. Update the job note's `resume_used` field to the final `.pdf` path.

Target: $ARGUMENTS
