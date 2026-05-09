import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnCommentDeleteRequest,
  OnCommentReportRequest,
  OnPostDeleteRequest,
  OnPostReportRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import {
  setConfig,
  getConfig,
  incrementDailyVolume,
  getVolumeBaseline,
} from '../redis/config.js';
import {
  getActiveIncidents,
  tagItemToIncident,
  removeContentFromIncidents,
} from '../redis/incidents.js';
import { releaseClaim } from '../redis/claims.js';
import { getCoverageGaps } from '../redis/coverage.js';
import { notifyMods, formatVolumeSpike } from '../notifications/notify.js';
import {
  APP_VERSION,
  QUEUE_SURGE_MULTIPLIER,
  volumeSpikeAlertKey,
  VOLUME_SPIKE_ALERT_TTL_SECONDS,
} from '../shared/constants.js';

export const triggers = new Hono();

const TRIGGER_OK: TriggerResponse = {};

triggers.post('/on-app-install', async (c) => {
  try {
    const input = await c.req.json<OnAppInstallRequest>();
    console.log(`SubStation installed to r/${input.subreddit?.name ?? '?'}`);

    // Don't clobber an existing config on reinstall — preserve API keys, lead mod, etc.
    const existing = await getConfig();
    if (existing) {
      await setConfig({ version: APP_VERSION });
      return c.json<TriggerResponse>(TRIGGER_OK, 200);
    }

    await setConfig({
      aiProvider: 'gemini',
      aiApiKey: '',
      notifChannel: 'modmail',
      version: APP_VERSION,
      installedAt: Date.now(),
      leadMod: '',
      p1Def: '',
      p2Def: '',
      p3Def: '',
    });
  } catch (err) {
    console.error('on-app-install failed', err);
  }
  return c.json<TriggerResponse>(TRIGGER_OK, 200);
});

triggers.post('/on-app-upgrade', async (c) => {
  try {
    await c.req.json<OnAppUpgradeRequest>();
    console.log(`SubStation upgraded in r/${context.subredditName ?? '?'}`);
    await setConfig({ version: APP_VERSION });
  } catch (err) {
    console.error('on-app-upgrade failed', err);
  }
  return c.json<TriggerResponse>(TRIGGER_OK, 200);
});

function todayDateString(): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function maybeAlertVolumeSpike(args: {
  volume: number;
  baseline: number;
  hour: number;
  inCoverageGap: boolean;
}): Promise<void> {
  const dedupeKey = volumeSpikeAlertKey(todayDateString());
  const existing = await redis.get(dedupeKey);
  if (existing) return;

  await redis.set(dedupeKey, '1');
  await redis.expire(dedupeKey, VOLUME_SPIKE_ALERT_TTL_SECONDS);

  await notifyMods(
    formatVolumeSpike({
      volume: args.volume,
      baseline: args.baseline,
      multiplier: QUEUE_SURGE_MULTIPLIER,
      hour: args.hour,
      inCoverageGap: args.inCoverageGap,
    })
  );
}

async function handleReport(contentId: string): Promise<void> {
  if (!contentId) return;

  const volume = await incrementDailyVolume();

  const activeIncidents = await getActiveIncidents();
  if (activeIncidents.length > 0) {
    const mostRecent = activeIncidents[activeIncidents.length - 1]!;
    try {
      await tagItemToIncident(mostRecent.id, contentId);
    } catch (err) {
      console.error('tagItemToIncident failed', err);
    }
  }

  const baseline = await getVolumeBaseline();
  if (baseline > 0 && volume > baseline * QUEUE_SURGE_MULTIPLIER) {
    const gaps = await getCoverageGaps();
    const currentHour = new Date().getUTCHours();
    const inCoverageGap = !!gaps && gaps.gapHours.includes(currentHour);

    if (inCoverageGap) {
      console.warn(
        `Queue surge detected during coverage gap (hour ${currentHour}). ` +
          `Volume ${volume} exceeds ${baseline * QUEUE_SURGE_MULTIPLIER} threshold.`
      );
    }

    try {
      await maybeAlertVolumeSpike({
        volume,
        baseline,
        hour: currentHour,
        inCoverageGap,
      });
    } catch (err) {
      console.error('volume spike alert failed', err);
    }
  }
}

triggers.post('/on-post-report', async (c) => {
  try {
    const input = await c.req.json<OnPostReportRequest>();
    const postId = input.post?.id;
    if (postId) await handleReport(postId);
  } catch (err) {
    console.error('on-post-report failed', err);
  }
  return c.json<TriggerResponse>(TRIGGER_OK, 200);
});

triggers.post('/on-comment-report', async (c) => {
  try {
    const input = await c.req.json<OnCommentReportRequest>();
    const commentId = input.comment?.id;
    if (commentId) await handleReport(commentId);
  } catch (err) {
    console.error('on-comment-report failed', err);
  }
  return c.json<TriggerResponse>(TRIGGER_OK, 200);
});

triggers.post('/on-content-delete', async (c) => {
  try {
    // Single endpoint receives both PostDelete (postId at top level) and
    // CommentDelete (commentId at top level). Tolerate either shape.
    const input = await c.req.json<
      Partial<OnPostDeleteRequest> & Partial<OnCommentDeleteRequest>
    >();
    const contentId = input.commentId ?? input.postId;
    if (!contentId) return c.json<TriggerResponse>(TRIGGER_OK, 200);

    await releaseClaim(contentId).catch((err) =>
      console.error('releaseClaim failed', err)
    );

    const activeIncidents = await getActiveIncidents();
    const activeIds = activeIncidents.map((i) => i.id);
    if (activeIds.length > 0) {
      await removeContentFromIncidents(contentId, activeIds).catch((err) =>
        console.error('removeContentFromIncidents failed', err)
      );
    }
  } catch (err) {
    console.error('on-content-delete failed', err);
  }
  return c.json<TriggerResponse>(TRIGGER_OK, 200);
});
