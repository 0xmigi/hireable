# PDF Export Playbook

The canonical path for converting a Markdown file in the workspace into a submission-ready PDF. Used by `hireable tailor`, master-resume bootstrap, and any other moment a PDF is needed.

## Goal

The user never has to leave the chat to get a PDF. They approve content; a PDF appears in the workspace at the expected path; the relevant `resume_used` (or equivalent) field is updated to point at the PDF. **The PDF must be visually presentable** — a resume that lands in front of a recruiter cannot have browser print headers, file:// footers, or default CSS.

## Conversion priority

### 1. Vendor-shipped `pdf` skill — ALWAYS TRY THIS FIRST IF AVAILABLE

If your agent harness ships a named skill that handles PDF generation, **invoke it before reaching for local tools**. Examples:

- Claude Code / claude.ai / cowork: `anthropic-skills:pdf`
- Other harnesses: any equivalent — look for "pdf" or "document generation" in the available skill list

This is the only path that produces visually presentable output without a styling template you've curated yourself. If your harness has one of these skills available, use it — don't skip to pandoc or chrome-headless because they're "more familiar." That route produces ugly PDFs (default print headers, file:// footers, browser-default CSS).

Invocation pattern: hand the skill the source `.md` path and the desired output path. Confirm the file exists at the output path before continuing.

If your harness has no PDF skill at all, fall through to step 2.

### 2. Local `pandoc` with `xelatex` — only if the `pdf` skill is unavailable

Check `command -v pandoc` and verify `xelatex` is installed (run `pandoc --pdf-engine=xelatex --version` quickly, or test on a small file). If both are present:

```bash
pandoc <source>.md -o <output>.pdf --pdf-engine=xelatex -V geometry:margin=0.75in -V mainfont="Helvetica" -V fontsize=11pt
```

If `xelatex` isn't installed, do not silently fall through to a worse engine. Stop here and surface the failure (next section). `wkhtmltopdf` and `weasyprint` produce mediocre output for resumes; pandoc → HTML → Chrome `--print-to-pdf` produces actively bad output (default print headers, file:// footers, browser-default CSS). **Never use the Chrome-headless path** — it is a known-bad fallback.

### 3. Local `typst` — only if the `pdf` skill is unavailable AND no LaTeX

Check `command -v typst`. If yes, the user needs a Typst template — either one already in `resumes/` or scaffolded once with permission. Without a template, Typst output is also generic; don't reach for it as a blind fallback.

### 4. Surface the failure — do not produce bad output

If none of the above work, **stop and tell the user**. Do not produce a PDF that looks unprofessional just to claim the task is "done." Save the `.md` to its intended path, leave `resume_used` pointing at it, and say something like:

```
Couldn't generate a presentable PDF — the pdf skill isn't available in this session, and pandoc lacks xelatex.

Options:
  (a) Install BasicTeX once: brew install --cask basictex && eval "$(/usr/libexec/path_helper)" — pandoc will then produce clean output. Resume the conversion afterward.
  (b) Open the .md in your usual editor (Pages, Word, etc.) and Print → Save as PDF. Tell me the path and I'll update resume_used.
  (c) I'll convert via Chrome --headless --print-to-pdf — but I have to flag this produces a noticeably worse-looking PDF (default print headers, generic CSS). Only use this if you're not actually submitting.
```

The Chrome path is mentioned only with explicit warning. If the user picks (c), use the flags `--no-pdf-header-footer --hide-scrollbars` to at least suppress headers, but still warn the output is below their master's quality.

## When this runs

- **`hireable tailor`** — after the user approves bullet swaps and the `.md` derivative is written, generate the PDF immediately and point `resume_used` at it.
- **Master resume in MD** — Branch 1 of SKILL.md generates `master.pdf` once, after the source is written.
- **Cover letters or other written outputs** — same path applies whenever the user says "give me the PDF" or the next step is submission.

## What this playbook doesn't do

- Doesn't try to install tooling. The skill does not run `brew install` or `npm install -g` — surface the install command, let the user choose.
- Doesn't pretty-print or redesign the source. The PDF is a faithful conversion; styling defaults from the converter, not bespoke layout.
- Doesn't keep `.md` and `.pdf` in sync after later edits. The `.md` is the source of truth; regenerate the `.pdf` when content changes.
- Doesn't silently fall back to a worse path. Quality > completion.
