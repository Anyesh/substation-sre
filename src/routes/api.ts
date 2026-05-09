import { Hono } from 'hono';
import { redis, reddit, scheduler } from '@devvit/web/server';
import {
  createIncident,
  getActiveIncidents,
  getIncident,
  closeIncident,
  setAiSummary,
  tagItemToIncident,
} from '../redis/incidents.js';
import { createClaim, getActiveClaims } from '../redis/claims.js';
import {
  computeCoverageGaps,
  getCoverageGaps,
  setCoverageGaps,
  setModSchedule,
  addModToRegistry,
} from '../redis/coverage.js';
import {
  getDailyVolume,
  getVolumeBaseline,
  setVolumeBaseline,
  incrementDailyVolume,
} from '../redis/config.js';
import { todayDateString } from '../redis/workload.js';
import { getConfig } from '../redis/config.js';
import { generatePostmortem } from '../ai/postmortem.js';
import { notifyMods, formatIncidentDeclared } from '../notifications/notify.js';
import {
  patternRadarKey,
  radarLockKey,
  PATTERN_RADAR_TTL_SECONDS,
} from '../shared/constants.js';
import type {
  Incident,
  PatternRadarResult,
  Severity,
} from '../shared/types.js';

export const api = new Hono();

api.get('/dashboard', async (c) => {
  const [activeIncidents, activeClaims, radarRaw, coverageGaps] = await Promise.all([
    getActiveIncidents(),
    getActiveClaims(),
    redis.get(patternRadarKey()),
    getCoverageGaps(),
  ]);

  const date = todayDateString();
  const [dailyVolume, baseline] = await Promise.all([
    getDailyVolume(date),
    getVolumeBaseline(),
  ]);

  const patternRadar: PatternRadarResult | null = radarRaw
    ? (JSON.parse(radarRaw) as PatternRadarResult)
    : null;

  return c.json({
    activeIncidents,
    activeClaims,
    patternRadar,
    coverageGaps,
    stats: { dailyVolume, baseline },
  });
});

api.get('/incident/:id', async (c) => {
  const id = c.req.param('id');
  const incident = await getIncident(id);
  if (!incident) return c.json({ error: 'Incident not found' }, 404);
  return c.json({ incident });
});

api.post('/declare-incident', async (c) => {
  const body = await c.req.json<{
    title?: string;
    severity?: string;
    description?: string;
  }>();

  if (!body.title || !body.severity) {
    return c.json({ error: 'title and severity are required' }, 400);
  }

  const declaredBy = (await reddit.getCurrentUser())?.username ?? 'unknown';

  const incident = await createIncident({
    id: crypto.randomUUID(),
    title: body.title,
    description: body.description ?? '',
    severity: body.severity as Severity,
    declaredBy,
    declaredAt: Date.now(),
  });

  notifyMods(formatIncidentDeclared(incident)).catch((err) =>
    console.error('Notify failed', err)
  );

  return c.json({ incident });
});

api.post('/close-incident', async (c) => {
  const { incidentId } = await c.req.json<{ incidentId: string }>();

  const incident = await getIncident(incidentId);
  if (!incident) {
    return c.json({ error: 'Incident not found' }, 404);
  }

  // If a post-mortem is already attached (e.g. seeded demo data), reuse it
  // instead of re-generating. Guarantees the demo always shows the polished
  // version regardless of whether an AI key is configured.
  if (incident.aiSummary && incident.aiSummary.trim().length > 0) {
    await closeIncident(incidentId, '');
    return c.json({
      status: 'ok',
      incidentId,
      postmortem: incident.aiSummary,
    });
  }

  const closedAt = Date.now();
  const closed: Incident = { ...incident, closedAt, status: 'closed' };

  let postmortem = '';
  try {
    const config = await getConfig();
    if (config?.aiApiKey) {
      postmortem = await generatePostmortem(
        { provider: config.aiProvider, apiKey: config.aiApiKey, baseUrl: config.aiBaseUrl || undefined, model: config.aiModel || undefined },
        {
          title: closed.title,
          severity: closed.severity,
          description: closed.description,
          declaredAt: closed.declaredAt,
          closedAt,
          itemCount: closed.itemCount,
          aiSummary: closed.aiSummary,
        },
        [],
        []
      );
    } else {
      postmortem = stubPostmortem(closed);
    }
  } catch (err) {
    console.error('Postmortem generation failed', err);
    postmortem = stubPostmortem(closed);
  }

  await closeIncident(incidentId, '');
  await setAiSummary(incidentId, postmortem);

  return c.json({ status: 'ok', incidentId, postmortem });
});

api.post('/refresh-radar', async (c) => {
  const lockVal = await redis.get(radarLockKey());
  if (lockVal) {
    return c.json(
      { error: 'Pattern radar scan in progress or rate-limited. Try again later.' },
      429
    );
  }

  await scheduler.runJob({
    name: 'pattern-radar-scan',
    runAt: new Date(),
  });

  return c.json({ status: 'accepted' }, 202);
});

api.post('/seed-demo', async (c) => {
  const user = await reddit.getCurrentUser();
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  await seedDemoData();
  return c.json({ status: 'ok' });
});

function stubPostmortem(incident: Incident): string {
  const declared = new Date(incident.declaredAt).toUTCString();
  const closed = new Date(incident.closedAt ?? Date.now()).toUTCString();
  const minutes = Math.max(
    1,
    Math.round(((incident.closedAt ?? Date.now()) - incident.declaredAt) / 60_000)
  );
  return [
    `# Post-mortem: ${incident.title}`,
    '',
    `**Severity:** ${incident.severity}  `,
    `**Declared:** ${declared}  `,
    `**Closed:** ${closed}  `,
    `**Time to resolve:** ${minutes} minute${minutes === 1 ? '' : 's'}  `,
    `**Items affected:** ${incident.itemCount}`,
    '',
    '## Summary',
    incident.description || '_No description provided._',
    '',
    '## Timeline',
    `- ${declared} — Incident declared by u/${incident.declaredBy}.`,
    `- ${closed} — Incident closed.`,
    '',
    '## Recommended changes',
    '- Configure an AI provider key in SubStation Settings to generate richer post-mortems automatically.',
  ].join('\n');
}

const DEMO_RADAR: PatternRadarResult = {
  generatedAt: Date.now(),
  anomalyScore: 78,
  clusters: [
    {
      label: 'Coordinated brigade — politics keywords',
      count: 14,
      examples: [
        'Account age 2d, identical phrasing across 4 posts',
        'Cross-posted from r/<external> within 90s window',
        'Three accounts upvoted each others\' replies',
      ],
    },
    {
      label: 'Off-topic image dumps',
      count: 6,
      examples: ['Meme reposts from r/<other>', 'Karma-farm pattern'],
    },
    {
      label: 'Rule 3 violations (low-effort)',
      count: 5,
      examples: ['One-line submissions with no context'],
    },
  ],
  coordinatedSignals: [
    'Three reported posts share the same image hash.',
    'Five accounts created within the last 48 hours all reported by the same user.',
    'Comment storm in thread t3_demo_post — 22 replies in 4 minutes.',
  ],
  suggestedAutomods: [
    'Filter posts from accounts < 7d old containing keyword "RIGGED"',
    'Auto-report comments matching regex /(brigade|raid)/i in r/yoursub',
  ],
};

function buildDemoPostmortem(incident: Incident): string {
  const declared = new Date(incident.declaredAt);
  const closed = new Date(incident.declaredAt + 24 * 60_000);
  const fmt = (d: Date) =>
    `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;

  return [
    `# Post-mortem: ${incident.title}`,
    '',
    `**Severity:** ${incident.severity}  `,
    `**Declared:** ${fmt(declared)} by u/${incident.declaredBy}  `,
    `**Closed:** ${fmt(closed)}  `,
    `**Time to resolve:** 24 minutes  `,
    `**Items affected:** 17 (12 posts, 5 comments)  `,
    `**Mods on shift:** demo_lead_mod, mod_alice`,
    '',
    '## Summary',
    '',
    'A brigade originating from r/<external> targeted the subreddit between',
    '02:48 and 03:09 UTC. The wave consisted of accounts under 48h old posting',
    'near-identical content with embedded political keywords. Three of the posts',
    "reached the front page before reports came in. SubStation's pattern radar",
    'grouped 14 reports into a single coordinated cluster within 7 minutes.',
    '',
    '## Timeline',
    '',
    '- **02:48** — First report on `t3_demo_aaa`. Volume baseline 40/day; instantaneous rate 12/min, 18× baseline.',
    '- **02:51** — Pattern radar groups 5 items into "Coordinated brigade — politics keywords" cluster, anomaly score **78**.',
    '- **02:53** — u/demo_lead_mod claims `t3_demo_aaa` and declares P1 incident.',
    '- **02:54–03:01** — 9 subsequent reports auto-tag to the incident.',
    '- **02:57** — Coverage-gap alert: incident overlaps known gap hour 03:00 UTC. Modmail sent.',
    '- **03:01** — u/mod_alice joins from EMEA shift; removes 5 comments in incident thread.',
    '- **03:09** — Last brigade item removed. Verified clean for 3 minutes.',
    '- **03:12** — Incident closed.',
    '',
    '## Impact',
    '',
    '- 17 items removed (12 posts, 5 comments)',
    '- 3 posts reached front page; combined ~2.3k views before removal',
    '- 2 mods engaged for 24 minutes',
    '- 1 P1 alert fired during off-hours',
    '',
    '## Contributing factors',
    '',
    '- All 7 author accounts were created within the last 48 hours; AutoMod did not have an age filter for political-keyword posts.',
    '- Inbound content shared an image hash from a known cross-post source not on the spam allowlist.',
    '- Coverage gap at 03:00–05:00 UTC; without SubStation\'s gap alert, response would have lagged ~40 minutes.',
    '',
    '## Actions taken',
    '',
    '- Bulk removal of all 17 incident-tagged items.',
    '- 4 user bans (3 permanent, 1 seven-day for a borderline account).',
    '- One AutoMod rule added (see below).',
    '',
    '## Recommended changes',
    '',
    'Add to AutoMod:',
    '',
    '```yaml',
    '---',
    'type: submission',
    'author:',
    '    account_age: "< 7 days"',
    'body+title (regex): "(?i)(rigged|brigade-keyword)"',
    'action: filter',
    'action_reason: "SubStation: account age < 7d + brigade keywords"',
    '---',
    '```',
    '',
    'Consider:',
    '',
    '- Lowering the coverage-gap notification threshold from 60 → 30 minutes for P1 events.',
    '- Adding `r/<external>` to the high-risk cross-post watchlist.',
    '- Wiki-pinning this post-mortem in the mod handbook.',
    '',
    '## Open questions',
    '',
    '- Did the 4th post that reached the front page receive any awards before removal? (impacts notification escalation)',
    '- Should we automate "lock new posts" during P1 incidents while mods are off-shift?',
    '',
    '_Generated by SubStation. Edit in mod wiki before publishing._',
  ].join('\n');
}

async function seedDemoData(): Promise<void> {
  const incident = await createIncident({
    id: crypto.randomUUID(),
    title: 'Coordinated brigade from r/<external>',
    description:
      'Accounts under 48h old posting near-identical content. Several reached the front page before reports came in.',
    severity: 'P1',
    declaredBy: 'demo_lead_mod',
    declaredAt: Date.now() - 12 * 60_000,
  });

  // Pre-bake the post-mortem so closing the seeded incident always shows the
  // polished version, regardless of AI key configuration.
  await setAiSummary(incident.id, buildDemoPostmortem(incident));

  const demoItems = [
    't3_demo_aaa',
    't3_demo_bbb',
    't3_demo_ccc',
    't1_demo_111',
    't1_demo_222',
  ];
  for (const id of demoItems) {
    await tagItemToIncident(incident.id, id);
  }

  const demoClaims: Array<{ id: string; mod: string }> = [
    { id: 't3_demo_xxx', mod: 'demo_lead_mod' },
    { id: 't3_demo_yyy', mod: 'mod_alice' },
    { id: 't1_demo_aaa', mod: 'mod_bob' },
    { id: 't1_demo_bbb', mod: 'mod_alice' },
  ];
  for (const claim of demoClaims) {
    await createClaim(claim.id, claim.mod);
  }

  await redis.set(
    patternRadarKey(),
    JSON.stringify({ ...DEMO_RADAR, generatedAt: Date.now() })
  );
  await redis.expire(patternRadarKey(), PATTERN_RADAR_TTL_SECONDS);

  const demoSchedules: Array<{ user: string; range: [number, number] }> = [
    { user: 'demo_lead_mod', range: [13, 21] },
    { user: 'mod_alice', range: [21, 5] },
    { user: 'mod_bob', range: [5, 13] },
  ];
  for (const { user, range } of demoSchedules) {
    await setModSchedule(user, {
      timezone: 'UTC',
      activeHours: [range],
      status: 'available',
      statusUpdatedAt: Date.now(),
    });
    await addModToRegistry(user);
  }
  // Force a couple of gap hours for the demo so the strip is visually interesting.
  const gaps = computeCoverageGaps([
    {
      username: 'demo_lead_mod',
      schedule: {
        timezone: 'UTC',
        activeHours: [[10, 14], [16, 22]],
        status: 'available',
        statusUpdatedAt: Date.now(),
      },
    },
  ]);
  await setCoverageGaps(gaps);

  await setVolumeBaseline(40);
  for (let i = 0; i < 95; i++) {
    await incrementDailyVolume();
  }
}
