export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ClaudeMessage[];
  cache_control?: { type: 'ephemeral' };
}

export interface ClaudeResponse {
  id: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export async function callClaude(
  apiKey: string,
  request: ClaudeRequest,
): Promise<ClaudeResponse> {
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };

  // Build body, handling cache_control by converting system to content blocks
  const { cache_control, system, ...rest } = request;
  const body: Record<string, unknown> = { ...rest };

  if (system) {
    if (cache_control) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
      body.system = [{ type: 'text', text: system, cache_control }];
    } else {
      body.system = system;
    }
  }

  const RETRYABLE = new Set([429, 500, 529]);
  const MAX_RETRIES = 3;
  const jsonBody = JSON.stringify(body);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: jsonBody,
    });

    if (res.ok) {
      return res.json() as Promise<ClaudeResponse>;
    }

    const resBody = await res.text();

    if (attempt < MAX_RETRIES && RETRYABLE.has(res.status)) {
      const retryAfter = res.headers.get('retry-after');
      const delayMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000) : 1000 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    throw new Error(`Claude API error ${res.status}: ${resBody}`);
  }

  throw new Error('Claude API: max retries exceeded');
}

export function extractText(response: ClaudeResponse): string {
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('No text block in Claude response');
  return block.text;
}
