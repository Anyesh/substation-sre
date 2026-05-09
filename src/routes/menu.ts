import { Hono } from 'hono';
import { reddit, redis } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import type { FormField } from '@devvit/shared-types/shared/form.js';
import { isClaimedByOther, createClaim, getClaim } from '../redis/claims.js';
import { getActiveIncidents } from '../redis/incidents.js';
import { dashboardPostKey } from '../shared/constants.js';

export const menu = new Hono();

async function handleClaimRequest(targetId: string): Promise<UiResponse> {
  const user = await reddit.getCurrentUser();
  if (!user) return { showToast: 'Could not identify current user.' };
  const username = user.username;

  const claimed = await isClaimedByOther(targetId, username);
  if (claimed) {
    const existing = await getClaim(targetId);
    return { showToast: `Already claimed by ${existing?.mod ?? 'another mod'}.` };
  }

  await createClaim(targetId, username);
  return { showToast: "Claimed. Other mods can see you're handling it." };
}

menu.post('/claim-post', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const result = await handleClaimRequest(request.targetId);
  return c.json<UiResponse>(result, 200);
});

menu.post('/claim-comment', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const result = await handleClaimRequest(request.targetId);
  return c.json<UiResponse>(result, 200);
});

menu.post('/tag-to-incident', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const targetId = request.targetId;
  const activeIncidents = await getActiveIncidents();

  if (activeIncidents.length === 0) {
    return c.json<UiResponse>({ showToast: 'No active incidents.' }, 200);
  }

  const fields: FormField[] = [
    {
      name: 'incidentId',
      label: 'Incident',
      type: 'select',
      options: activeIncidents.map((i) => ({ value: i.id, label: i.title })),
      required: true,
    },
    {
      name: 'targetId',
      label: 'Target ID',
      type: 'string',
      defaultValue: targetId,
      required: true,
      disabled: true,
    },
  ];

  return c.json<UiResponse>({
    showForm: {
      name: 'tagToIncident',
      form: { fields, title: 'Tag to Incident', acceptLabel: 'Tag', cancelLabel: 'Cancel' },
    },
  }, 200);
});

menu.post('/tag-comment-to-incident', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const targetId = request.targetId;
  const activeIncidents = await getActiveIncidents();

  if (activeIncidents.length === 0) {
    return c.json<UiResponse>({ showToast: 'No active incidents.' }, 200);
  }

  const fields: FormField[] = [
    {
      name: 'incidentId',
      label: 'Incident',
      type: 'select',
      options: activeIncidents.map((i) => ({ value: i.id, label: i.title })),
      required: true,
    },
    {
      name: 'targetId',
      label: 'Target ID',
      type: 'string',
      defaultValue: targetId,
      required: true,
      disabled: true,
    },
  ];

  return c.json<UiResponse>({
    showForm: {
      name: 'tagToIncident',
      form: { fields, title: 'Tag Comment to Incident', acceptLabel: 'Tag', cancelLabel: 'Cancel' },
    },
  }, 200);
});

function toAbsoluteUrl(permalink: string): string {
  if (permalink.startsWith('http')) return permalink;
  return `https://www.reddit.com${permalink}`;
}

async function resolveDashboardPostUrl(): Promise<string | null> {
  const cachedId = await redis.get(dashboardPostKey());
  if (cachedId && cachedId.startsWith('t3_')) {
    try {
      const existing = await reddit.getPostById(cachedId as `t3_${string}`);
      if (existing && !existing.removed) {
        return toAbsoluteUrl(existing.permalink);
      }
    } catch {
      // Fall through to recreate.
    }
  }

  const subreddit = await reddit.getCurrentSubreddit();
  const post = await reddit.submitCustomPost({
    subredditName: subreddit.name,
    title: 'SubStation Dashboard',
    runAs: 'APP',
  });

  await redis.set(dashboardPostKey(), post.id);
  return toAbsoluteUrl(post.permalink);
}

menu.post('/open-dashboard', async (c) => {
  try {
    const url = await resolveDashboardPostUrl();
    if (!url) {
      return c.json<UiResponse>(
        { showToast: 'Could not open dashboard. Try again.' },
        200
      );
    }
    return c.json<UiResponse>({ navigateTo: url }, 200);
  } catch (err) {
    console.error('open-dashboard failed', err);
    return c.json<UiResponse>(
      { showToast: 'Failed to open dashboard. Check app permissions.' },
      200
    );
  }
});

menu.post('/declare-incident', async (c) => {
  const fields: FormField[] = [
    {
      name: 'title',
      label: 'Incident Title',
      type: 'string',
      required: true,
    },
    {
      name: 'severity',
      label: 'Severity',
      type: 'select',
      options: [
        { value: 'P1', label: 'P1 - Critical' },
        { value: 'P2', label: 'P2 - Major' },
        { value: 'P3', label: 'P3 - Minor' },
      ],
      required: true,
    },
    {
      name: 'description',
      label: 'Description',
      type: 'paragraph',
    },
  ];

  return c.json<UiResponse>({
    showForm: {
      name: 'declareIncident',
      form: { fields, title: 'Declare Incident', acceptLabel: 'Declare', cancelLabel: 'Cancel' },
    },
  }, 200);
});

menu.post('/settings', async (c) => {
  const fields: FormField[] = [
    {
      name: 'aiProvider',
      label: 'AI Provider',
      type: 'select',
      options: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'gemini', label: 'Gemini' },
      ],
    },
    {
      name: 'aiApiKey',
      label: 'AI API Key',
      helpText: 'OpenAI or Gemini API key. Stored per-subreddit; required for pattern radar and post-mortems.',
      type: 'string',
    },
    {
      name: 'aiBaseUrl',
      label: 'AI Base URL (optional)',
      helpText: 'Custom OpenAI-compatible endpoint (e.g. http://10.0.0.10:8081 for local LLM). Leave blank for default.',
      type: 'string',
    },
    {
      name: 'aiModel',
      label: 'AI Model (optional)',
      helpText: 'Model name override (e.g. gemma4, llama3). Leave blank for default (gpt-4o-mini or gemini-2.0-flash).',
      type: 'string',
    },
    {
      name: 'leadMod',
      label: 'Lead Moderator',
      type: 'string',
    },
    {
      name: 'p1Def',
      label: 'P1 Definition',
      type: 'string',
    },
    {
      name: 'p2Def',
      label: 'P2 Definition',
      type: 'string',
    },
    {
      name: 'p3Def',
      label: 'P3 Definition',
      type: 'string',
    },
    {
      name: 'notifChannel',
      label: 'Notification Channel',
      type: 'select',
      options: [
        { value: 'modmail', label: 'Modmail' },
        { value: 'pm', label: 'Private Message' },
      ],
    },
  ];

  return c.json<UiResponse>({
    showForm: {
      name: 'settings',
      form: { fields, title: 'SubStation Settings', acceptLabel: 'Save', cancelLabel: 'Cancel' },
    },
  }, 200);
});
