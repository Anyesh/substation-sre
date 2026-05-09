# SubStation — Devpost Submission

## Project Name
SubStation

## Tagline
PagerDuty for subreddits. Coordinated incident response for mod teams, built on Devvit.

## Inspiration
When a subreddit gets brigaded at 3 AM, mod teams rely on Discord pings, modmail threads, and luck. Two mods remove the same comment. Nobody knows who's handling what. The brigade ends, and there's no record of what happened or what to change. We built SubStation because moderators deserve the same incident-response tooling that SRE teams have used for years.

## What it does
SubStation turns Reddit moderation into structured incident response:

- **Claims** — One click from the post/comment menu marks who's handling what. No more two mods removing the same item.
- **Incidents with severity** — Declare P1/P2/P3 incidents. Incoming reports auto-tag to the active incident. Full timeline preserved for 90 days.
- **AI pattern radar** — Every 5 minutes, the mod queue is analyzed for coordination signals: account age clusters, identical phrasing, cross-post timing. Returns anomaly scores, clusters, and copy-pasteable AutoMod YAML.
- **Coverage map** — Mods register active hours. A 24-hour UTC strip on the dashboard shows gap hours in red. Volume spikes during gaps trigger modmail alerts.
- **Auto post-mortems** — Closing an incident generates a structured markdown report with timeline, impact analysis, contributing factors, and recommended AutoMod changes. Works with OpenAI, Gemini, or any OpenAI-compatible endpoint.
- **Live dashboard** — A Devvit custom post with five panels: active incidents, claims, coverage map, pattern radar, and queue volume stats. Declare incidents, close them, and copy post-mortems without leaving Reddit.

## How we built it
- **Devvit Web** (`@devvit/web` 0.12) for server-side logic, Redis storage, and Reddit API access
- **Hono** as the server router handling 7 menu items, 4 forms, 6 triggers, and 7 scheduled jobs
- **Vanilla TypeScript** on the client — no framework, no heavy bundle. One HTML/CSS/TS file each for the dashboard webview
- **Vite** for a single build pipeline emitting server and client bundles
- **Vitest** with 21 tests: 17 unit tests for coverage math, prompt builders, and notification formatters, plus 4 integration tests hitting a real LLM

The AI layer is provider-agnostic: a thin client that speaks OpenAI and Gemini protocols. Configurable base URL and model name let teams point at any OpenAI-compatible endpoint. Without an API key, everything degrades gracefully — post-mortems use a deterministic template, pattern radar skips cleanly.

Seven scheduled jobs run in the background: pattern radar scans every 5 minutes, modlog sync and coverage computation run hourly, claim garbage collection every 15 minutes, volume baseline daily, and incident pruning and workload rollups weekly.

## Challenges we ran into
- **Devvit's `navigateTo` requires absolute URLs** — relative permalinks silently fail. Discovered during live testing.
- **`hGetAll` on fresh Redis throws** instead of returning empty — crashed the install trigger on first deployment. Added guards.
- **Devvit proxies all HTTP through their servers** — custom LLM domains get blocked even when declared in permissions. We designed around this by supporting the pre-approved OpenAI and Gemini domains.
- **Race conditions in Redis** — concurrent reports during a brigade wave caused silent undercount of incident items. Fixed with atomic `hIncrBy` instead of read-modify-write. Modlog sync had no cursor, re-processing the same 100 entries every hour and inflating workload counters.

## Accomplishments that we're proud of
- The incident-response framing is genuinely novel for Reddit moderation tooling. No other tool treats mod ops as structured incidents with severity, claims, timelines, and post-mortems.
- Graceful degradation everywhere: no API key? Template post-mortems. No mod queue items? Radar skips. No schedules registered? Coverage shows "no data." Nothing crashes.
- 21 passing tests including 4 that hit a real LLM and validate structured JSON output.
- The dashboard is a single custom post — mods don't leave Reddit to coordinate.

## What we learned
- Devvit Web is powerful but has sharp edges around HTTP permissions and URL handling that only surface during live testing.
- Writing the tests before fixing the bugs (TDD) caught three additional issues we hadn't noticed in code review.
- Small models (0.5B) struggle with structured JSON output for pattern radar, but handle markdown post-mortems well enough for a demo.

## What's next for SubStation
- **Pre-populate settings forms** — Devvit forms always show blank; we'd add a read-then-fill pattern so mods see their current config.
- **Mod workload dashboard** — the data is already collected via modlog sync. Surface it as a leaderboard panel.
- **Webhook notifications** — beyond modmail/PM, push to Discord or Slack for teams that coordinate off-Reddit.
- **AutoMod rule application** — currently suggests YAML; could auto-apply rules with mod approval.

## Built With
devvit, typescript, hono, vite, vitest, redis, openai, gemini

## Tool Overview

SubStation is a moderation coordination app that brings structured incident response to Reddit. Here is how moderators use it:

**Setup (one-time):** Install the app, open SubStation: Settings from the subreddit menu, optionally add an OpenAI or Gemini API key for AI features.

**Daily use:**
- When a mod spots a problematic post or comment, they click "SubStation: Claim post/comment" from the context menu. This marks the item as being handled, preventing other mods from duplicating work.
- If a pattern emerges (brigade, spam wave), any mod can declare a P1/P2/P3 incident from the dashboard. All subsequent reports auto-tag to the active incident.
- The dashboard (a custom post) shows five live panels: active incidents, claimed items, 24-hour coverage map, AI pattern radar results, and report volume vs. baseline.
- Every 5 minutes, the pattern radar scans the mod queue and groups reports into clusters with coordination signals (account age, phrasing similarity, cross-post timing). It suggests AutoMod YAML rules.
- Mods register their active hours. The coverage map highlights gap hours in red. If report volume spikes during a gap, SubStation sends a modmail alert.
- Closing an incident generates a structured post-mortem (timeline, impact, contributing factors, recommended changes) that can be copied to the mod wiki.

**Background automation:** 7 scheduled jobs handle pattern scanning, modlog sync, coverage computation, claim cleanup, volume baseline tracking, incident archival, and workload rollups. All run automatically with no mod intervention.

**Without AI:** Everything works. Post-mortems use a deterministic template. Pattern radar skips. No crashes, no broken UI.

## Project Impact

1. **r/politics and large news subreddits (1M+ subscribers):** These communities face coordinated brigades during election cycles and breaking news events. SubStation's pattern radar would catch account-age clustering and cross-post timing that manual moderation misses. The claims system alone prevents the double-removal problem that wastes mod time during high-volume events.

2. **r/gaming and fan community subreddits (500K-5M subscribers):** Game launches and controversy events trigger massive report spikes. The coverage map exposes timezone gaps where no mod is on shift, and the volume spike alerts ensure someone gets notified even at 3 AM. Post-mortems help these teams build institutional knowledge about recurring raid patterns.

3. **r/AskScience, r/AskHistorians and quality-focused subreddits (1M+ subscribers):** These communities have strict content standards and rely heavily on coordinated mod response. The workload tracking and coverage analysis help distribute the burden fairly across the team, and incident history gives new mods context on past enforcement decisions.

**Time savings estimate:** For a 10-person mod team handling 2-3 incidents per month, SubStation eliminates an estimated 30-45 minutes of coordination overhead per incident (duplicate removals, "who's handling this?" messages, manual post-mortem writing).

## [For Ported Projects] Original Bot username

N/A. SubStation is a new app.

## [For Ported Projects] Port Completion

N/A. SubStation is a new app built from scratch for the Reddit Mod Tools Hackathon.

## Try it out
- **GitHub:** https://github.com/Anyesh/substation-sre
- **Devvit App:** https://developers.reddit.com/apps/sub-station-sre
- **Live Demo:** https://www.reddit.com/r/dreamery/
