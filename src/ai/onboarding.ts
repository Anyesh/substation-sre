import type { AiConfig } from './client.js';
import { callAi } from './client.js';
import { buildOnboardingPrompt } from './prompts.js';

export async function generateOnboardingGuide(
  config: AiConfig,
  subredditName: string,
  rules: string[],
  topRemovalReasons: string[],
  recentIncidents: string[]
): Promise<string> {
  const { system, user } = buildOnboardingPrompt(
    subredditName,
    rules,
    topRemovalReasons,
    recentIncidents
  );
  return callAi(config, system, user);
}
