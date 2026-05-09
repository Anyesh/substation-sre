import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { createIncident, tagItemToIncident } from '../redis/incidents.js';
import { setConfig } from '../redis/config.js';
import { setModSchedule, addModToRegistry } from '../redis/coverage.js';
import { notifyMods, formatIncidentDeclared } from '../notifications/notify.js';
import type { Severity, ModStatus } from '../shared/types.js';

export const forms = new Hono();

forms.post('/declare-incident', async (c) => {
  const values = await c.req.json<{
    title: string;
    severity: string | string[];
    description?: string;
  }>();

  const user = await reddit.getCurrentUser();
  if (!user) return c.json<UiResponse>({ showToast: 'Could not identify user.' }, 200);
  const severity = (Array.isArray(values.severity) ? values.severity[0] : values.severity) as Severity;

  const incident = await createIncident({
    id: crypto.randomUUID(),
    title: values.title,
    description: values.description ?? '',
    severity,
    declaredBy: user.username,
    declaredAt: Date.now(),
  });

  await notifyMods(formatIncidentDeclared(incident));

  return c.json<UiResponse>({
    showToast: `Incident declared: ${incident.title}`,
  }, 200);
});

forms.post('/tag-to-incident', async (c) => {
  const values = await c.req.json<{
    incidentId: string | string[];
    targetId: string;
  }>();

  const incidentId = Array.isArray(values.incidentId) ? values.incidentId[0]! : values.incidentId;
  await tagItemToIncident(incidentId, values.targetId);

  return c.json<UiResponse>({
    showToast: 'Tagged to incident.',
  }, 200);
});

forms.post('/settings', async (c) => {
  const values = await c.req.json<{
    aiProvider?: string | string[];
    aiApiKey?: string;
    aiBaseUrl?: string;
    aiModel?: string;
    leadMod?: string;
    p1Def?: string;
    p2Def?: string;
    p3Def?: string;
    notifChannel?: string | string[];
  }>();

  console.log('Settings form received');
  const configUpdate: Record<string, string> = {};
  const aiProvider = Array.isArray(values.aiProvider) ? values.aiProvider[0] : values.aiProvider;
  const notifChannel = Array.isArray(values.notifChannel) ? values.notifChannel[0] : values.notifChannel;
  if (aiProvider) configUpdate['aiProvider'] = aiProvider;
  if (values.aiApiKey) configUpdate['aiApiKey'] = values.aiApiKey;
  if (values.aiBaseUrl !== undefined) configUpdate['aiBaseUrl'] = values.aiBaseUrl;
  if (values.aiModel !== undefined) configUpdate['aiModel'] = values.aiModel;
  if (values.leadMod) configUpdate['leadMod'] = values.leadMod;
  if (values.p1Def) configUpdate['p1Def'] = values.p1Def;
  if (values.p2Def) configUpdate['p2Def'] = values.p2Def;
  if (values.p3Def) configUpdate['p3Def'] = values.p3Def;
  if (notifChannel) configUpdate['notifChannel'] = notifChannel;

  await setConfig(configUpdate as Partial<import('../shared/types.js').AppConfig>);

  return c.json<UiResponse>({
    showToast: 'Settings saved.',
  }, 200);
});

forms.post('/set-schedule', async (c) => {
  const values = await c.req.json<{
    timezone: string;
    activeStart: number;
    activeEnd: number;
    status: string | string[];
  }>();

  const user = await reddit.getCurrentUser();
  if (!user) return c.json<UiResponse>({ showToast: 'Could not identify user.' }, 200);
  const status = (Array.isArray(values.status) ? values.status[0] : values.status) as ModStatus;

  await setModSchedule(user.username, {
    timezone: values.timezone,
    activeHours: [[values.activeStart, values.activeEnd]],
    status,
    statusUpdatedAt: Date.now(),
  });
  await addModToRegistry(user.username);

  return c.json<UiResponse>({
    showToast: 'Schedule updated.',
  }, 200);
});
