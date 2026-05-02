---
description: Surface stale threads with proposed nudges, ranked by urgency
---

Activate the hireable skill and run `hireable radar`. Follow `references/stale-radar.md`: scan all job notes' frontmatter for staleness against the per-status thresholds, apply the override conditions (deadlines, passed `next_action_date`, hired-by proximity), and output one block per stale thread ranked by urgency. Cross-reference connected channels if available to flag notes whose `last_interaction` is behind reality.

Don't draft messages or update any files — this is a reporting pass. End with a one-line tally.
