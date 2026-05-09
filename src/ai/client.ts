export type AiConfig = {
  provider: 'openai' | 'gemini';
  apiKey: string;
  baseUrl?: string;
  model?: string;
};

export async function callAi(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (config.provider === 'openai') {
    return callOpenAi(config.apiKey, systemPrompt, userPrompt, config.baseUrl, config.model);
  }
  return callGemini(config.apiKey, systemPrompt, userPrompt);
}

export async function callAiJson<T>(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  const raw = await callAi(config, systemPrompt, userPrompt);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`AI returned invalid JSON. Raw response: ${raw}`);
  }
}

async function callOpenAi(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  baseUrl?: string,
  model?: string
): Promise<string> {
  const url = `${baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model ?? 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message.content;
  if (!content) {
    throw new Error('OpenAI returned empty content');
  }
  return content;
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  const text = data.candidates[0]?.content.parts[0]?.text;
  if (!text) {
    throw new Error('Gemini returned empty content');
  }
  return text;
}
