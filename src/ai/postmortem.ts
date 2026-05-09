import type { AiConfig } from './client.js';
import { callAi } from './client.js';
import { buildPostmortemPrompt } from './prompts.js';

export async function generatePostmortem(
  config: AiConfig,
  incident: Parameters<typeof buildPostmortemPrompt>[0],
  modActions: Parameters<typeof buildPostmortemPrompt>[1],
  participatingMods: string[]
): Promise<string> {
  const { system, user } = buildPostmortemPrompt(
    incident,
    modActions,
    participatingMods
  );
  return callAi(config, system, user);
}
