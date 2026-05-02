---
description: Fetch a job listing URL and scaffold a populated job note
argument-hint: <listing-url>
---

Activate the hireable skill and run `hireable ingest` for the URL below. Follow `references/listing-extraction.md`: fetch the listing, extract the role metadata, scaffold the note from `templates/job-note.md`, and confirm the filename with me before writing the file.

If the URL is a job board (Workable / Lever / Ashby / Greenhouse / Gem / direct careers), use the per-board hints in the playbook.

If the URL is a **social post** (x.com, twitter.com, linkedin.com, etc.), follow the "Non-standard listings" section of the playbook — fetch via Chrome MCP, capture author + apply method explicitly, leave structured fields blank rather than guess, set `channel:` to the platform.

If I paste the listing text directly instead of a URL (Telegram / Discord / Slack / DM forward), treat the paste as the source and ask me for the channel name and apply target if they aren't obvious.

**Be tight with chat output.** When the fast-path conditions in the playbook hold (recognized board, unambiguous fields, no filename collision), skip the multi-paragraph "I'm fetching… extracting… here's what I found… should I save?" preview entirely. Write the file directly and output one line: `Wrote <filename> ✓ — view in dashboard.` Save my eyes for the dashboard, not the chat.

URL: $ARGUMENTS
