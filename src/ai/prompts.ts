type PromptPair = { system: string; user: string };

type PatternItem = {
  title: string;
  reportReason: string;
  authorAge: string;
};

type IncidentInfo = {
  title: string;
  severity: string;
  description: string;
  declaredAt: number;
  closedAt: number;
  itemCount: number;
  aiSummary: string;
};

type ModAction = {
  mod: string;
  action: string;
  target: string;
  timestamp: number;
};

export function buildPatternRadarPrompt(
  items: PatternItem[],
  subredditRules: string[]
): PromptPair {
  const system =
    'You are a pattern analysis engine for Reddit moderation. ' +
    'Analyze reported content and detect coordination, emerging clusters, and anomalies. ' +
    'Respond ONLY with valid JSON matching the schema provided.';

  const schema = JSON.stringify(
    {
      clusters: [{ label: 'string', count: 'number', examples: ['string'] }],
      anomalyScore: 'number (0-100)',
      coordinatedSignals: ['string'],
      suggestedAutomods: ['string'],
    },
    null,
    2
  );

  const user = [
    'Reported items:',
    JSON.stringify(items, null, 2),
    '',
    'Subreddit rules:',
    subredditRules.map((r, i) => `${i + 1}. ${r}`).join('\n'),
    '',
    'Respond with JSON matching this schema:',
    schema,
  ].join('\n');

  return { system, user };
}

export function buildPostmortemPrompt(
  incident: IncidentInfo,
  modActions: ModAction[],
  participatingMods: string[]
): PromptPair {
  const system =
    'You are an incident post-mortem generator for Reddit moderation teams. ' +
    'Write a structured post-mortem in markdown format.';

  const user = [
    'Incident:',
    JSON.stringify(incident, null, 2),
    '',
    'Mod actions taken:',
    JSON.stringify(modActions, null, 2),
    '',
    'Participating moderators: ' + participatingMods.join(', '),
    '',
    'Write a post-mortem with these sections:',
    '- Summary',
    '- Timeline',
    '- Impact (items affected, time to resolve)',
    '- Contributing Factors',
    '- Actions Taken',
    '- Recommended Changes (include specific AutoMod YAML if applicable)',
    '- Open Questions',
  ].join('\n');

  return { system, user };
}

export function buildOnboardingPrompt(
  subredditName: string,
  rules: string[],
  topRemovalReasons: string[],
  recentIncidents: string[]
): PromptPair {
  const system =
    'You are a mod team onboarding guide generator. ' +
    "Write a friendly, practical first-week guide for a new moderator. " +
    "Be specific to this subreddit's norms.";

  const user = [
    `Subreddit: r/${subredditName}`,
    '',
    'Rules:',
    rules.map((r, i) => `${i + 1}. ${r}`).join('\n'),
    '',
    'Top removal reasons:',
    topRemovalReasons.map((r) => `- ${r}`).join('\n'),
    '',
    'Recent incident summaries:',
    recentIncidents.map((r) => `- ${r}`).join('\n'),
    '',
    'Write a markdown onboarding guide with these sections:',
    '- Welcome',
    '- What Gets Removed Most',
    '- How We Coordinate (explain SubStation briefly)',
    '- Coverage Expectations',
    "- When You're Unsure",
  ].join('\n');

  return { system, user };
}
