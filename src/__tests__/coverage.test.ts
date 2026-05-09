import { describe, expect, test, vi } from 'vitest';

vi.mock('@devvit/web/server', () => ({
  redis: {
    hSet: vi.fn(),
    hGetAll: vi.fn(),
    set: vi.fn(),
    get: vi.fn(),
    expire: vi.fn(),
    zAdd: vi.fn(),
    zRange: vi.fn(),
  },
}));

import { computeCoverageGaps } from '../redis/coverage.js';
import type { ModSchedule } from '../shared/types.js';

const baseSchedule = (activeHours: [number, number][]): ModSchedule => ({
  timezone: 'UTC',
  activeHours,
  status: 'available',
  statusUpdatedAt: 0,
});

describe('computeCoverageGaps', () => {
  test('returns all 24 hours as gaps when no schedules', () => {
    const result = computeCoverageGaps([]);
    expect(result.gapHours).toHaveLength(24);
    expect(result.gapHours).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22, 23,
    ]);
  });

  test('returns no gaps when full coverage', () => {
    const result = computeCoverageGaps([
      { username: 'a', schedule: baseSchedule([[0, 24]]) },
    ]);
    expect(result.gapHours).toEqual([]);
  });

  test('handles ranges that wrap past midnight', () => {
    const result = computeCoverageGaps([
      { username: 'night', schedule: baseSchedule([[22, 6]]) },
    ]);
    expect(result.gapHours).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  test('combines coverage from multiple mods', () => {
    const result = computeCoverageGaps([
      { username: 'morning', schedule: baseSchedule([[6, 14]]) },
      { username: 'evening', schedule: baseSchedule([[14, 22]]) },
    ]);
    expect(result.gapHours).toEqual([0, 1, 2, 3, 4, 5, 22, 23]);
  });

  test('handles overlapping schedules without double-counting', () => {
    const result = computeCoverageGaps([
      { username: 'a', schedule: baseSchedule([[0, 12]]) },
      { username: 'b', schedule: baseSchedule([[6, 18]]) },
    ]);
    expect(result.gapHours).toEqual([18, 19, 20, 21, 22, 23]);
  });

  test('sets a computedAt timestamp', () => {
    const before = Date.now();
    const result = computeCoverageGaps([]);
    const after = Date.now();
    expect(result.computedAt).toBeGreaterThanOrEqual(before);
    expect(result.computedAt).toBeLessThanOrEqual(after);
  });
});
