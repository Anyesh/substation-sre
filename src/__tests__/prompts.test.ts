import { describe, expect, test } from 'vitest';
import {
  buildPatternRadarPrompt,
  buildPostmortemPrompt,
  buildOnboardingPrompt,
} from '../ai/prompts.js';

describe('buildPatternRadarPrompt', () => {
  test('embeds the items and rules and asks for JSON', () => {
    const items = [
      { title: 'Spam post', reportReason: 'spam', authorAge: '0d' },
      { title: 'Off-topic', reportReason: 'off-topic', authorAge: '12d' },
    ];
    const rules = ['No spam', 'Stay on topic'];
    const { system, user } = buildPatternRadarPrompt(items, rules);

    expect(system).toMatch(/JSON/);
    expect(user).toContain('Spam post');
    expect(user).toContain('Off-topic');
    expect(user).toContain('1. No spam');
    expect(user).toContain('2. Stay on topic');
    expect(user).toContain('clusters');
    expect(user).toContain('anomalyScore');
  });

  test('handles empty inputs without error', () => {
    const { user } = buildPatternRadarPrompt([], []);
    expect(user).toContain('Reported items:');
    expect(user).toContain('Subreddit rules:');
  });
});

describe('buildPostmortemPrompt', () => {
  test('includes incident, actions, and participating mods', () => {
    const { user } = buildPostmortemPrompt(
      {
        title: 'Brigade wave',
        severity: 'P1',
        description: 'Coordinated attack',
        declaredAt: 0,
        closedAt: 1000,
        itemCount: 42,
        aiSummary: 'summary',
      },
      [{ mod: 'modA', action: 'remove', target: 't3_x', timestamp: 100 }],
      ['modA', 'modB']
    );

    expect(user).toContain('Brigade wave');
    expect(user).toContain('modA, modB');
    expect(user).toContain('remove');
    expect(user).toMatch(/Recommended Changes/);
    expect(user).toMatch(/Timeline/);
  });
});

describe('buildOnboardingPrompt', () => {
  test('produces guide instructions for the named subreddit', () => {
    const { user } = buildOnboardingPrompt(
      'cats',
      ['No dogs', 'Be kind'],
      ['off-topic', 'low-effort'],
      ['Brigade in March']
    );

    expect(user).toContain('r/cats');
    expect(user).toContain('1. No dogs');
    expect(user).toContain('- off-topic');
    expect(user).toContain('Brigade in March');
    expect(user).toMatch(/Welcome/);
    expect(user).toMatch(/Coverage Expectations/);
  });
});
