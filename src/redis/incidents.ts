import { redis } from '@devvit/web/server';
import type { Incident } from '../shared/types.js';
import {
  incidentKey,
  incidentsActiveKey,
  incidentsHistoryKey,
  incidentItemsKey,
} from '../shared/constants.js';

export async function createIncident(
  incident: Omit<Incident, 'closedAt' | 'status' | 'itemCount' | 'aiSummary' | 'postmortemUrl'>
): Promise<Incident> {
  const full: Incident = {
    ...incident,
    closedAt: null,
    status: 'active',
    itemCount: 0,
    aiSummary: '',
    postmortemUrl: '',
  };

  await redis.hSet(incidentKey(full.id), {
    id: full.id,
    title: full.title,
    description: full.description,
    severity: full.severity,
    declaredBy: full.declaredBy,
    declaredAt: String(full.declaredAt),
    closedAt: '',
    status: full.status,
    itemCount: '0',
    aiSummary: '',
    postmortemUrl: '',
  });

  await redis.zAdd(incidentsActiveKey(), {
    member: full.id,
    score: full.declaredAt,
  });

  return full;
}

function parseIncident(data: Record<string, string>): Incident {
  return {
    id: data['id'] ?? '',
    title: data['title'] ?? '',
    description: data['description'] ?? '',
    severity: (data['severity'] as Incident['severity']) ?? 'P3',
    declaredBy: data['declaredBy'] ?? '',
    declaredAt: Number(data['declaredAt'] ?? 0),
    closedAt: data['closedAt'] ? Number(data['closedAt']) : null,
    status: (data['status'] as Incident['status']) ?? 'active',
    itemCount: Number(data['itemCount'] ?? 0),
    aiSummary: data['aiSummary'] ?? '',
    postmortemUrl: data['postmortemUrl'] ?? '',
  };
}

export async function getIncident(id: string): Promise<Incident | null> {
  let data: Record<string, string>;
  try {
    data = await redis.hGetAll(incidentKey(id));
  } catch {
    return null;
  }
  if (!data || Object.keys(data).length === 0) return null;
  return parseIncident(data);
}

export async function getActiveIncidents(): Promise<Incident[]> {
  const members = await redis.zRange(incidentsActiveKey(), 0, -1);
  const incidents: Incident[] = [];

  for (const entry of members) {
    const incident = await getIncident(entry.member);
    if (incident) incidents.push(incident);
  }

  return incidents;
}

export async function closeIncident(
  id: string,
  postmortemUrl: string
): Promise<void> {
  const now = Date.now();

  await redis.hSet(incidentKey(id), {
    closedAt: String(now),
    status: 'closed',
    postmortemUrl,
  });

  await redis.zRem(incidentsActiveKey(), [id]);
  await redis.zAdd(incidentsHistoryKey(), { member: id, score: now });
}

export async function setAiSummary(id: string, markdown: string): Promise<void> {
  await redis.hSet(incidentKey(id), { aiSummary: markdown });
}

export async function tagItemToIncident(
  incidentId: string,
  contentId: string
): Promise<void> {
  await redis.zAdd(incidentItemsKey(incidentId), {
    member: contentId,
    score: Date.now(),
  });

  await redis.hIncrBy(incidentKey(incidentId), 'itemCount', 1);
}

export async function getIncidentItems(incidentId: string): Promise<string[]> {
  const entries = await redis.zRange(incidentItemsKey(incidentId), 0, -1);
  return entries.map((e) => e.member);
}

export async function removeContentFromIncidents(
  contentId: string,
  activeIncidentIds: string[]
): Promise<void> {
  for (const incidentId of activeIncidentIds) {
    await redis.zRem(incidentItemsKey(incidentId), [contentId]);
  }
}
