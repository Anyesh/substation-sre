# Privacy Policy

**SubStation** is a Devvit app that runs entirely within Reddit's infrastructure.

## Data collected

- **Mod schedules**: Timezone and active hours voluntarily entered by moderators, stored in Reddit's Devvit Redis.
- **Incident metadata**: Titles, descriptions, severity levels, timestamps, and item counts for declared incidents.
- **Claim records**: Which moderator claimed which content item, with timestamps.
- **Workload counts**: Aggregated action counts (removals, approvals, bans) per moderator, derived from the public mod log.
- **AI API keys**: If provided, stored per-subreddit in Devvit Redis. Keys are sent only to the configured AI provider (OpenAI or Google Gemini) and are never logged or transmitted elsewhere.

## Data not collected

- No personal information beyond Reddit usernames (which are already public).
- No content of posts or comments is stored. Only Reddit content IDs are referenced.
- No data is sent to any third party other than the AI provider explicitly configured by the moderator.
- No analytics, tracking, or telemetry.

## Data storage

All data is stored in Devvit's Redis, scoped to the subreddit where the app is installed. Data is automatically pruned: claims expire after 15 minutes, incidents are archived after 90 days.

## Data deletion

Uninstalling the app removes all stored data.

## Contact

For questions, open an issue at https://github.com/Anyesh/substation-sre/issues.
