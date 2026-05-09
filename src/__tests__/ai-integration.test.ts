import { describe, it, expect } from 'vitest';
import type { AiConfig } from '../ai/client.js';
import { callAi, callAiJson } from '../ai/client.js';
import { buildPostmortemPrompt, buildPatternRadarPrompt } from '../ai/prompts.js';
import type { PatternRadarResult } from '../shared/types.js';

const OLLAMA_BASE = 'http://localhost:11434';
const OLLAMA_MODEL = 'gemma4';

const ollamaConfig: AiConfig = {
  provider: 'openai',
  apiKey: 'ollama',
  baseUrl: OLLAMA_BASE,
  model: OLLAMA_MODEL,
};

async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/v1/models`);
    return res.ok;
  } catch {
    return false;
  }
}

describe('AI Integration (Ollama)', () => {
  it('callAi returns non-empty string', async () => {
    if (!(await ollamaAvailable())) return;

    const result = await callAi(
      ollamaConfig,
      'You are a helpful assistant.',
      'Say "hello" and nothing else.'
    );

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  }, 120_000);

  it('postmortem prompt produces valid markdown', async () => {
    if (!(await ollamaAvailable())) return;

    const incident = {
      title: 'Test brigade incident',
      severity: 'P1',
      description: 'Coordinated spam wave from external subreddit',
      declaredAt: Date.now() - 30 * 60_000,
      closedAt: Date.now(),
      itemCount: 12,
      aiSummary: '',
    };

    const { system, user } = buildPostmortemPrompt(incident, [], ['test_mod']);
    const result = await callAi(ollamaConfig, system, user);

    expect(result).toContain('Summary');
    expect(result).toContain('Timeline');
    expect(result.length).toBeGreaterThan(200);
  }, 120_000);

  it('pattern radar prompt returns parseable JSON', async () => {
    if (!(await ollamaAvailable())) return;

    const items = [
      { title: 'Political post #1', reportReason: 'spam', authorAge: '1d' },
      { title: 'Political post #2', reportReason: 'spam', authorAge: '2d' },
      { title: 'Political post #3', reportReason: 'brigading', authorAge: '1d' },
      { title: 'Meme repost', reportReason: 'low effort', authorAge: '30d' },
      { title: 'Normal discussion', reportReason: 'off-topic', authorAge: '365d' },
    ];

    const { system, user } = buildPatternRadarPrompt(items, ['No spam', 'No brigading']);
    const result = await callAi(ollamaConfig, system, user);

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();

    const parsed = JSON.parse(jsonMatch![0]) as Partial<PatternRadarResult>;
    expect(parsed).toHaveProperty('clusters');
    expect(parsed).toHaveProperty('anomalyScore');
    expect(Array.isArray(parsed.clusters)).toBe(true);
    expect(typeof parsed.anomalyScore).toBe('number');
  }, 120_000);

  it('callAiJson parses structured radar response', async () => {
    if (!(await ollamaAvailable())) return;

    const items = [
      { title: 'Spam post A', reportReason: 'spam', authorAge: '0d' },
      { title: 'Spam post B', reportReason: 'spam', authorAge: '1d' },
    ];

    const { system, user } = buildPatternRadarPrompt(items, []);

    try {
      const parsed = await callAiJson<Omit<PatternRadarResult, 'generatedAt'>>(
        ollamaConfig,
        system,
        user
      );
      expect(Array.isArray(parsed.clusters)).toBe(true);
      expect(typeof parsed.anomalyScore).toBe('number');
      expect(Array.isArray(parsed.coordinatedSignals)).toBe(true);
      expect(Array.isArray(parsed.suggestedAutomods)).toBe(true);
    } catch (err) {
      expect((err as Error).message).toContain('invalid JSON');
    }
  }, 120_000);
});
