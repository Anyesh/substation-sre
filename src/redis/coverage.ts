import { redis } from '@devvit/web/server';
import type { ModSchedule, CoverageGaps } from '../shared/types.js';
import {
  modScheduleKey,
  coverageGapsKey,
  COVERAGE_TTL_SECONDS,
} from '../shared/constants.js';

const COVERAGE_MODS_KEY = 'coverage:mods';

export async function setModSchedule(
  username: string,
  schedule: ModSchedule
): Promise<void> {
  await redis.hSet(modScheduleKey(username), {
    timezone: schedule.timezone,
    activeHours: JSON.stringify(schedule.activeHours),
    status: schedule.status,
    statusUpdatedAt: String(schedule.statusUpdatedAt),
  });
  await addModToRegistry(username);
}

export async function getModSchedule(
  username: string
): Promise<ModSchedule | null> {
  const data = await redis.hGetAll(modScheduleKey(username));
  if (!data || Object.keys(data).length === 0) return null;

  return {
    timezone: data['timezone'] ?? 'UTC',
    activeHours: JSON.parse(data['activeHours'] ?? '[]') as [number, number][],
    status: (data['status'] as ModSchedule['status']) ?? 'offline',
    statusUpdatedAt: Number(data['statusUpdatedAt'] ?? '0'),
  };
}

export async function getAllModSchedules(): Promise<
  Array<{ username: string; schedule: ModSchedule }>
> {
  const members = await redis.zRange(COVERAGE_MODS_KEY, 0, -1);
  const results: Array<{ username: string; schedule: ModSchedule }> = [];

  for (const entry of members) {
    const schedule = await getModSchedule(entry.member);
    if (schedule) results.push({ username: entry.member, schedule });
  }

  return results;
}

export async function addModToRegistry(username: string): Promise<void> {
  await redis.zAdd(COVERAGE_MODS_KEY, { member: username, score: 0 });
}

export function computeCoverageGaps(
  schedules: Array<{ username: string; schedule: ModSchedule }>
): CoverageGaps {
  const coveredHours = new Set<number>();

  for (const { schedule } of schedules) {
    for (const [start, end] of schedule.activeHours) {
      if (start <= end) {
        for (let h = start; h < end; h++) {
          coveredHours.add(h);
        }
      } else {
        // Wraps past midnight, e.g. [22, 6] means 22-23 and 0-5
        for (let h = start; h < 24; h++) {
          coveredHours.add(h);
        }
        for (let h = 0; h < end; h++) {
          coveredHours.add(h);
        }
      }
    }
  }

  const gapHours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (!coveredHours.has(h)) gapHours.push(h);
  }

  return {
    computedAt: Date.now(),
    gapHours,
  };
}

export async function setCoverageGaps(gaps: CoverageGaps): Promise<void> {
  await redis.set(coverageGapsKey(), JSON.stringify(gaps));
  await redis.expire(coverageGapsKey(), COVERAGE_TTL_SECONDS);
}

export async function getCoverageGaps(): Promise<CoverageGaps | null> {
  const raw = await redis.get(coverageGapsKey());
  if (!raw) return null;
  return JSON.parse(raw) as CoverageGaps;
}
