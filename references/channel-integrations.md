# Channel Integrations

Use channels to reduce missed opportunities, not to remove the user's judgment.

## Channel States

- `connected`: the agent/tool can inspect or summarize the channel directly.
- `manual`: the user pastes messages, exports snippets, or summarizes updates.
- `not_used`: the channel is irrelevant to this search.
- `desired`: the user wants it connected later.

## Common Channels

- Email: recruiter outreach, application confirmations, scheduling, offers.
- LinkedIn: recruiter messages, hiring manager outreach, intro paths.
- Telegram: startup/crypto/private-network intros and fast-moving conversations.
- Discord: community hiring, founder/operator conversations.
- Calendar: interviews, deadlines, reminders.
- Phone/SMS: recruiter scheduling and urgent updates.

## Behavior

- During setup, ask which channels matter for inbound job-search communication.
- If a channel is connected, use it to identify new inbound messages, stale threads, deadlines, and missing replies.
- If a channel is manual, ask for pasted context only when it changes the next action.
- Never assume permission to send messages. Draft first unless explicit sending automation exists.
- Store summaries and decisions in Markdown notes instead of relying on channel history as the durable record.

## Reminder Logic

Set reminders based on evidence:

- A recruiter or contact gave a date or timeline.
- An interview, take-home, or offer has a deadline.
- The user sent a message and wants a nudge if no reply arrives.
- The search has a hired-by threshold that makes delay costly.

Avoid rigid cadence. A casual exploratory search and an urgent search should behave differently.
