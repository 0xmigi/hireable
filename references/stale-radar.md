# Stale Thread Radar Playbook

Backs the `hireable radar` command. Surfaces threads that have gone quiet past their natural follow-up window and proposes a single concrete next move per thread. Doesn't draft. Doesn't send.

## Goal

The user runs this once, scans the output in 30 seconds, and walks away knowing what needs a nudge today.

## Inputs

1. All `*.md` job notes at workspace root with `tags: [jobs]`. Read frontmatter (`status`, `last_interaction`, `next_action`, `next_action_date`, `deadline`, `contact`).
2. Connected channels (Gmail / Calendar / etc.) when available — for cross-referencing whether a reply has actually arrived but isn't yet recorded on the note.
3. `profile.md`'s hired-by date — adjusts the urgency dial.

## Heuristics

The radar is opinionated about what counts as "stale" by status. These are starting defaults, not laws — adjust based on user precedent in `references/follow-up-playbook.md`.

| Status | Stale after | Default proposed action |
|---|---|---|
| `applied` | 10 days no reply | Optional gentle nudge to recruiter or hiring manager if a contact is named. Otherwise: leave alone, applications without a contact rarely benefit from a poke. |
| `recruiter` / `screen` | 5 days no reply | Follow-up to the named contact. Reference the last point of contact. |
| `interview` / `takehome` / `final` | 3 days no reply (or `deadline` within 48h) | High priority. Likely needs a thank-you note or a "checking in" message. |
| `offer` / `negotiation` | Always surface | Decision-time threads always show up regardless of `last_interaction`. |
| `drafting` / `ready_to_apply` | 5 days since note created | The user started this and stalled. Surface as "decide: ship or archive." |
| `lead` / `qualified` | 14 days | Surface as "decide: pursue or archive." |
| `to_apply` | 7 days | Surface as "this is sitting — apply, deprioritize, or archive." |
| `accepted` / `declined` / `rejected` / `archived` | Never | Don't surface. |

Override conditions:

- A `deadline` within 7 days outranks the table — always surface.
- A `next_action_date` in the past — always surface, regardless of status.
- If the user's `Intended hired-by date` is within 30 days, halve the stale thresholds.

## Output format

One block per stale thread, ranked by urgency (deadline-imminent > offer/negotiation > later-stage > earlier-stage). Format:

```
<Company> – <Role>  [<status>]
  Last touch: <YYYY-MM-DD> (<N> days ago)
  Why surfaced: <one phrase — e.g. "post-interview silence", "deadline in 2 days", "next_action_date passed">
  Proposed: <one concrete action — e.g. "follow up with Charlie referencing your Apr 22 call">
```

End with a one-line summary: total count + count by urgency tier.

If nothing is stale, say so plainly: "Nothing's stale right now. Most recent activity: <Company> – <Role> (<date>)."

## What this command doesn't do

- Doesn't draft messages — that's a separate ask. After the user picks a thread to act on, draft on request.
- Doesn't send anything.
- Doesn't update `last_interaction` or any other field. State is observed, not mutated.
- Doesn't scold the user about volume or pace. Surface the facts; let them choose.

## When channels are connected

If Gmail is connected, briefly check whether each "stale" thread has had recent inbound activity not yet reflected on the note (search by company name, contact name, or thread subject). If found, prefix the entry with `⚠ inbound on <date>, not on note` so the user knows the note is behind reality, not the thread itself.

If channels are manual, don't check — the user-typed `last_interaction` is the source of truth.

## Tone

Concise, factual, non-judgmental. The radar is a reporting surface, not a performance review. Don't pad with reassurance ("don't worry, this is normal!") or pressure ("you should really…"). State what's stale, propose one move, move on.
