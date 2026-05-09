import { describe, expect, test, vi } from 'vitest';

vi.mock('@devvit/web/server', () => ({
  reddit: {
    sendPrivateMessage: vi.fn(),
    modMail: { createConversation: vi.fn() },
  },
  context: { subredditName: 'test' },
  redis: { hGetAll: vi.fn() },
}));

import {
  formatIncidentDeclared,
  formatVolumeSpike,
  formatCoverageGapAlert,
} from '../notifications/notify.js';
import type { Incident } from '../shared/types.js';

const incident: Incident = {
  id: '00000000-0000-0000-0000-000000000000',
  title: 'Server breach',
  description: 'Coordinated drama',
  severity: 'P1',
  declaredBy: 'lead',
  declaredAt: Date.UTC(2026, 0, 1, 12, 0, 0),
  closedAt: null,
  status: 'active',
  itemCount: 0,
  aiSummary: '',
  postmortemUrl: '',
};

describe('formatIncidentDeclared', () => {
  test('subject includes severity and title', () => {
    const args = formatIncidentDeclared(incident);
    expect(args.subject).toContain('P1');
    expect(args.subject).toContain('Server breach');
  });

  test('body includes the declarer and description', () => {
    const args = formatIncidentDeclared(incident);
    expect(args.body).toContain('u/lead');
    expect(args.body).toContain('Coordinated drama');
  });

  test('body falls back when description is empty', () => {
    const args = formatIncidentDeclared({ ...incident, description: '' });
    expect(args.body).toMatch(/No description provided/);
  });
});

describe('formatVolumeSpike', () => {
  test('mentions multiplier, baseline, and current volume', () => {
    const args = formatVolumeSpike({
      volume: 200,
      baseline: 50,
      multiplier: 3,
      hour: 4,
      inCoverageGap: true,
    });
    expect(args.body).toContain('200');
    expect(args.body).toContain('50');
    expect(args.body).toContain('3x');
    expect(args.body).toContain('04:00');
    expect(args.body).toMatch(/coverage gap/);
  });

  test('omits coverage gap text when not in gap', () => {
    const args = formatVolumeSpike({
      volume: 100,
      baseline: 30,
      multiplier: 3,
      hour: 12,
      inCoverageGap: false,
    });
    expect(args.body).not.toMatch(/coverage gap/);
  });
});

describe('formatCoverageGapAlert', () => {
  test('lists each gap hour padded to two digits', () => {
    const args = formatCoverageGapAlert([0, 1, 23]);
    expect(args.body).toContain('00:00');
    expect(args.body).toContain('01:00');
    expect(args.body).toContain('23:00');
  });

  test('signals no gaps when array empty', () => {
    const args = formatCoverageGapAlert([]);
    expect(args.body).toMatch(/no coverage gaps/);
  });
});
