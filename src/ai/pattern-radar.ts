import type { PatternRadarResult } from '../shared/types.js';
import type { AiConfig } from './client.js';
import { callAiJson } from './client.js';
import { buildPatternRadarPrompt } from './prompts.js';

type PatternItem = {
  title: string;
  reportReason: string;
  authorAge: string;
};

export async function runPatternRadar(
  config: AiConfig,
  items: PatternItem[],
  subredditRules: string[]
): Promise<PatternRadarResult> {
  const { system, user } = buildPatternRadarPrompt(items, subredditRules);
  const parsed = await callAiJson<Omit<PatternRadarResult, 'generatedAt'>>(
    config,
    system,
    user
  );
  return { ...parsed, generatedAt: Date.now() };
}
