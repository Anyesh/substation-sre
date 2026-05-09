import { redis } from '@devvit/web/server';
import type { WorkloadEntry } from '../shared/types.js';
import {
  workloadKey,
  workloadLeaderboardKey,
  WORKLOAD_TTL_SECONDS,
} from '../shared/constants.js';

export function todayDateString(): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function incrementWorkload(
  username: string,
  action: keyof WorkloadEntry
): Promise<void> {
  const date = todayDateString();
  const key = workloadKey(username, date);

  const existing = await redis.hGetAll(key);
  const isNew = !existing || Object.keys(existing).length === 0;

  const currentAction = Number(existing?.[action] ?? '0') + 1;
  const currentTotal = Number(existing?.['total'] ?? '0') + 1;

  await redis.hSet(key, {
    [action]: String(currentAction),
    total: String(currentTotal),
  });

  if (isNew) {
    await redis.expire(key, WORKLOAD_TTL_SECONDS);
  }

  await updateLeaderboard(username, date, currentTotal);
}

export async function getWorkload(
  username: string,
  date: string
): Promise<WorkloadEntry | null> {
  const data = await redis.hGetAll(workloadKey(username, date));
  if (!data || Object.keys(data).length === 0) return null;

  return {
    removals: Number(data['removals'] ?? '0'),
    approvals: Number(data['approvals'] ?? '0'),
    bans: Number(data['bans'] ?? '0'),
    mutes: Number(data['mutes'] ?? '0'),
    notes: Number(data['notes'] ?? '0'),
    total: Number(data['total'] ?? '0'),
  };
}

export async function getLeaderboard(
  date: string
): Promise<Array<{ username: string; total: number }>> {
  const members = await redis.zRange(workloadLeaderboardKey(date), 0, -1);
  const results: Array<{ username: string; total: number }> = [];

  for (const entry of members) {
    results.push({ username: entry.member, total: entry.score });
  }

  results.sort((a, b) => b.total - a.total);
  return results;
}

export async function updateLeaderboard(
  username: string,
  date: string,
  total: number
): Promise<void> {
  await redis.zAdd(workloadLeaderboardKey(date), {
    member: username,
    score: total,
  });
}
