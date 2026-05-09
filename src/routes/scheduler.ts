import { Hono } from 'hono';
import { redis, reddit } from '@devvit/web/server';
import type { TaskResponse } from '@devvit/web/server';
import { getConfig, setVolumeBaseline, getDailyVolume } from '../redis/config.js';
import { sweepExpiredClaims } from '../redis/claims.js';
import { incrementWorkload, getWorkload, updateLeaderboard, todayDateString } from '../redis/workload.js';
import {
  getAllModSchedules,
  computeCoverageGaps,
  setCoverageGaps,
  getCoverageGaps,
} from '../redis/coverage.js';
import { runPatternRadar } from '../ai/pattern-radar.js';
import { notifyMods, formatCoverageGapAlert } from '../notifications/notify.js';
import {
  patternRadarKey,
  radarLockKey,
  RADAR_LOCK_TTL_SECONDS,
  PATTERN_RADAR_TTL_SECONDS,
  INCIDENT_HISTORY_MAX_AGE_MS,
  incidentsHistoryKey,
  incidentKey,
  modlogCursorKey,
} from '../shared/constants.js';

export const schedulerRoutes = new Hono();

schedulerRoutes.post('/pattern-radar', async (c) => {
  const lockVal = await redis.get(radarLockKey());
  if (lockVal) {
    return c.json<TaskResponse>({}, 200);
  }

  await redis.set(radarLockKey(), '1', {
    expiration: new Date(Date.now() + RADAR_LOCK_TTL_SECONDS * 1000),
  });

  try {
    const config = await getConfig();
    if (!config) {
      console.log('Pattern radar: no config found, skipping.');
      return c.json<TaskResponse>({}, 200);
    }
    if (!config.aiApiKey) {
      console.log('Pattern radar: no AI API key configured, skipping.');
      return c.json<TaskResponse>({}, 200);
    }

    let items: Array<{ title: string; reportReason: string; authorAge: string }>;
    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const listing = subreddit.getModQueue({ type: 'all' });
      const queue = await listing.all();

      items = queue.map((item) => {
        const title = 'title' in item ? item.title : '';
        const body = item.body ?? '';
        const reasons = item.userReportReasons;
        const createdAt = item.createdAt;
        const ageDays = Math.floor(
          (Date.now() - createdAt.getTime()) / 86_400_000
        );

        return {
          title: title || body.slice(0, 200),
          reportReason: reasons[0] ?? 'unknown',
          authorAge: `${ageDays}d`,
        };
      });
    } catch (err) {
      console.error('Pattern radar: failed to fetch mod queue', err);
      return c.json<TaskResponse>({}, 200);
    }

    if (items.length === 0) {
      return c.json<TaskResponse>({}, 200);
    }

    try {
      const aiConfig = { provider: config.aiProvider, apiKey: config.aiApiKey, baseUrl: config.aiBaseUrl || undefined, model: config.aiModel || undefined };
      const result = await runPatternRadar(aiConfig, items, []);

      await redis.set(patternRadarKey(), JSON.stringify(result));
      await redis.expire(patternRadarKey(), PATTERN_RADAR_TTL_SECONDS);
    } catch (err) {
      console.error('Pattern radar: AI call failed', err);
    }
  } finally {
    // Release the lock so the next cron tick (or manual refresh) isn't blocked
    // for the full TTL when something throws above.
    await redis.del(radarLockKey()).catch(() => undefined);
  }

  return c.json<TaskResponse>({}, 200);
});

const ACTION_TO_FIELD: Record<string, keyof import('../shared/types.js').WorkloadEntry> = {
  removelink: 'removals',
  removecomment: 'removals',
  spamlink: 'removals',
  spamcomment: 'removals',
  approvelink: 'approvals',
  approvecomment: 'approvals',
  banuser: 'bans',
  muteuser: 'mutes',
  addnote: 'notes',
};

schedulerRoutes.post('/modlog-sync', async (c) => {
  try {
    const lastSyncedRaw = await redis.get(modlogCursorKey());
    const lastSyncedAt = lastSyncedRaw ? Number(lastSyncedRaw) : 0;

    const subreddit = await reddit.getCurrentSubreddit();
    const listing = reddit.getModerationLog({
      subredditName: subreddit.name,
      limit: 100,
    });
    const entries = await listing.all();

    const modTotals = new Map<string, number>();
    let newestTimestamp = lastSyncedAt;

    for (const entry of entries) {
      const entryTime = entry.createdAt.getTime();
      if (entryTime <= lastSyncedAt) continue;

      const mod = entry.moderatorName;
      const action = entry.type;
      if (!mod || !action) continue;

      const field = ACTION_TO_FIELD[action];
      if (field) {
        await incrementWorkload(mod, field);
        modTotals.set(mod, (modTotals.get(mod) ?? 0) + 1);
      }

      if (entryTime > newestTimestamp) newestTimestamp = entryTime;
    }

    if (newestTimestamp > lastSyncedAt) {
      await redis.set(modlogCursorKey(), String(newestTimestamp));
    }

    const date = todayDateString();
    for (const [mod] of modTotals) {
      const workload = await getWorkload(mod, date);
      if (workload) {
        await updateLeaderboard(mod, date, workload.total);
      }
    }
  } catch (err) {
    console.error('Modlog sync failed', err);
  }

  return c.json<TaskResponse>({}, 200);
});

schedulerRoutes.post('/coverage-compute', async (c) => {
  try {
    const schedules = await getAllModSchedules();
    const previous = await getCoverageGaps();
    const gaps = computeCoverageGaps(schedules);
    await setCoverageGaps(gaps);

    const previousSet = new Set(previous?.gapHours ?? []);
    const newHours = gaps.gapHours.filter((h) => !previousSet.has(h));
    if (gaps.gapHours.length > 0 && newHours.length > 0) {
      try {
        await notifyMods(formatCoverageGapAlert(gaps.gapHours));
      } catch (err) {
        console.error('Coverage gap alert failed', err);
      }
    }
  } catch (err) {
    console.error('Coverage compute failed', err);
  }
  return c.json<TaskResponse>({}, 200);
});

schedulerRoutes.post('/claim-sweep', async (c) => {
  try {
    const swept = await sweepExpiredClaims();
    console.log(`Claim sweep: removed ${swept} stale entries.`);
  } catch (err) {
    console.error('Claim sweep failed', err);
  }
  return c.json<TaskResponse>({}, 200);
});

schedulerRoutes.post('/volume-baseline', async (c) => {
  try {
    const volumes: number[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const vol = await getDailyVolume(dateStr);
      volumes.push(vol);
    }

    const nonZero = volumes.filter((v) => v > 0);
    const avg =
      nonZero.length > 0
        ? Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length)
        : 0;

    await setVolumeBaseline(avg);
    console.log(
      `Volume baseline updated: ${avg} (from ${nonZero.length} days of data)`
    );
  } catch (err) {
    console.error('Volume baseline failed', err);
  }
  return c.json<TaskResponse>({}, 200);
});

schedulerRoutes.post('/incident-prune', async (c) => {
  try {
    const cutoff = Date.now() - INCIDENT_HISTORY_MAX_AGE_MS;
    const stale = await redis.zRange(incidentsHistoryKey(), 0, cutoff, {
      by: 'score',
    });

    for (const entry of stale) {
      await redis.del(incidentKey(entry.member));
      await redis.zRem(incidentsHistoryKey(), [entry.member]);
    }

    if (stale.length > 0) {
      console.log(
        `Incident prune: removed ${stale.length} entries older than 90 days.`
      );
    }
  } catch (err) {
    console.error('Incident prune failed', err);
  }
  return c.json<TaskResponse>({}, 200);
});

schedulerRoutes.post('/workload-rollup', async (c) => {
  try {
    const schedules = await getAllModSchedules();
    const date = todayDateString();

    for (const { username } of schedules) {
      let weekTotal = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const workload = await getWorkload(username, dateStr);
        if (workload) {
          weekTotal += workload.total;
        }
      }
      await updateLeaderboard(username, date, weekTotal);
    }
  } catch (err) {
    console.error('Workload rollup failed', err);
  }
  return c.json<TaskResponse>({}, 200);
});
