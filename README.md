# SubStation

**PagerDuty for subreddits.** Coordinated incident response for moderator
teams, built on Devvit Web for the Reddit Mod Tools Hackathon.

When your sub gets brigaded at 3am, mod teams today rely on Discord pings,
modmail, and luck. SubStation gives them the same primitives SREs use to
handle production incidents — claims so two mods don't double-handle the
same comment, severity-tagged incident waves, AI pattern detection on the
mod queue, coverage-gap alerts, and auto-generated post-mortems — without
leaving Reddit.

---

## The 60-second story

> A coordinated brigade hits r/yoursub. SubStation's pattern radar groups
> 14 reported posts into a single cluster and flags the coordination
> signals. The lead mod declares a P1 incident from the dashboard. New
> reports auto-tag to the active incident. A coverage-gap alert fires
> because it's 03:00 UTC and nobody's on shift. When the wave is
> contained, one click closes the incident and produces a markdown
> post-mortem with timeline, impact, and a suggested AutoMod rule —
> ready to paste into the wiki.

That's the demo. Run it yourself in 30 seconds: install, open the
dashboard from the subreddit menu, click **Seed demo**.


## Why this wins

Other hackathon entries will be "AI helps mods." SubStation is the only
one framing mod ops as **incident response** — and the framing changes
the feature set:

- **Claims** — `/SubStation: Claim post` from the post menu marks who's
  handling what for 15 minutes. No more two mods removing the same
  comment 30 seconds apart.
- **Incidents with severity** — P1/P2/P3 tagging, item attachment,
  declared-by/closed-at timestamps, history retained 90 days.
- **AI pattern radar** — every 5 minutes, the mod queue is summarized
  into clusters, anomaly score, coordination signals (account age,
  identical phrasing, cross-post timing), and copy-pasteable AutoMod YAML
  suggestions.
- **Coverage map** — mods register their active hours. The dashboard
  renders a 24-cell UTC strip; gap hours light up red. Volume spikes
  during gaps trigger a modmail alert.
- **Auto post-mortems** — closing an incident generates a structured
  markdown report (Summary / Timeline / Impact / Contributing Factors /
  Recommended Changes / Open Questions). Provider-agnostic: works with
  OpenAI or Gemini.
- **Notifications, deduped** — modmail or PM, configurable per
  subreddit, with idempotency keys so a runaway trigger can't spam mods.

## Dashboard

The dashboard is a Devvit custom post — one click from the subreddit
menu. Five panels:

| Panel             | What it shows                                                              |
| ----------------- | -------------------------------------------------------------------------- |
| Active incidents  | Severity badge, declared-by, item count, **Close** → triggers post-mortem  |
| Active claims     | Who's handling what, with relative timestamps                              |
| Coverage map      | 24-hour UTC strip, gap hours in red, current hour outlined                 |
| Pattern radar     | AI-detected clusters, coordination signals, suggested AutoMod              |
| Queue volume      | Reports today vs 7-day baseline, with a `1.5×` / `3×` surge indicator      |

Top-bar actions: **Declare incident** (in-page modal), **Refresh**, **Run
radar**, **Seed demo**. Closing an incident opens the post-mortem in a
modal with **Copy markdown**.

## Architecture

```
src/
├── index.ts                # Hono entry, route mounting
├── shared/                 # Types, Redis key patterns, TTLs
├── redis/                  # Claims, incidents, workload, coverage, config
├── ai/                     # OpenAI/Gemini client + prompt builders
├── notifications/          # Modmail / PM helpers, message formatters
├── routes/
│   ├── api.ts              # /api/dashboard, /declare-incident, /close-incident,
│   │                       # /refresh-radar, /seed-demo
│   ├── menu.ts             # Subreddit/post/comment menu items
│   ├── forms.ts            # Devvit form handlers
│   ├── triggers.ts         # onAppInstall, onPostReport, onContentDelete, …
│   └── scheduler.ts        # Cron: pattern radar, modlog sync, coverage,
│                           #       claim sweep, volume baseline, prune, rollup
└── client/                 # Webview dashboard (vanilla TS, no framework cost)
    ├── index.html
    ├── styles.css
    └── main.ts
```

### Stack

- **Devvit Web** (`@devvit/web` 0.12) — server, redis, reddit APIs
- **Hono** — server router
- **Vite** — single build pipeline emits `dist/server/index.cjs` and
  `dist/client/{index.html,default.js,default.css}`
- **Vanilla TypeScript** on the client — no framework, no heavy bundle,
  one HTML/CSS/TS file each
- **Vitest** — 21 tests: 17 unit tests covering coverage gap math, prompt
  builders, and notification formatters, plus 4 integration tests validating
  real LLM calls against OpenAI-compatible endpoints

### Cron schedule

| Job                 | Cadence       | Purpose                                  |
| ------------------- | ------------- | ---------------------------------------- |
| `pattern-radar-scan`| every 5 min   | AI cluster detection on mod queue        |
| `modlog-sync`       | hourly        | Workload counts per mod from mod log     |
| `coverage-compute`  | hourly        | Recompute UTC gap hours, alert on new    |
| `claim-sweep`       | every 15 min  | Garbage-collect expired claim entries    |
| `volume-baseline`   | daily 00:00   | 7-day rolling average of report volume   |
| `incident-prune`    | weekly Sun    | Drop incident hashes older than 90 days  |
| `workload-rollup`   | weekly Mon    | Weekly workload leaderboard              |

## Getting started

```bash
npm install
npm run type-check          # tsc --build, zero errors
npm test                    # vitest run, 21 passing
npm run build               # vite build → dist/server + dist/client
npm run dev                 # devvit playtest
```

To enable AI features, open **SubStation: Settings** in the subreddit menu
and paste an OpenAI or Gemini API key. You can also point at any
OpenAI-compatible endpoint by setting a custom base URL and model name.
Without a key, post-mortems fall back to a deterministic template and
pattern radar skips cleanly.

## License

BSD-3-Clause.
