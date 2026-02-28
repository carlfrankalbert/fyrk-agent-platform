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

// --- Streaming ---

export type ClaudeStreamEvent =
  | { type: 'content_delta'; text: string }
  | { type: 'message_complete'; response: ClaudeResponse }
  | { type: 'error'; error: string };

export async function* callClaudeStream(
  apiKey: string,
  request: ClaudeRequest,
): AsyncGenerator<ClaudeStreamEvent> {
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };

  const { cache_control, system, ...rest } = request;
  const body: Record<string, unknown> = { ...rest, stream: true };

  if (system) {
    if (cache_control) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
      body.system = [{ type: 'text', text: system, cache_control }];
    } else {
      body.system = system;
    }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const resBody = await res.text();
    yield { type: 'error', error: `Claude API error ${res.status}: ${resBody}` };
    return;
  }

  if (!res.body) {
    yield { type: 'error', error: 'No response body' };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let messageId = '';
  let model = '';
  let stopReason = '';
  let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        const eventType = event.type as string;

        if (eventType === 'message_start') {
          const msg = event.message as Record<string, unknown>;
          messageId = (msg.id as string) ?? '';
          model = (msg.model as string) ?? '';
          const msgUsage = msg.usage as Record<string, number> | undefined;
          if (msgUsage) {
            usage.input_tokens = msgUsage.input_tokens ?? 0;
            usage.cache_read_input_tokens = msgUsage.cache_read_input_tokens ?? 0;
            usage.cache_creation_input_tokens = msgUsage.cache_creation_input_tokens ?? 0;
          }
        } else if (eventType === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta') {
            const text = delta.text as string;
            fullText += text;
            yield { type: 'content_delta', text };
          }
        } else if (eventType === 'message_delta') {
          const delta = event.delta as Record<string, unknown> | undefined;
          stopReason = (delta?.stop_reason as string) ?? '';
          const deltaUsage = event.usage as Record<string, number> | undefined;
          if (deltaUsage) {
            usage.output_tokens = deltaUsage.output_tokens ?? 0;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield {
    type: 'message_complete',
    response: {
      id: messageId,
      content: [{ type: 'text', text: fullText }],
      model,
      stop_reason: stopReason,
      usage,
    },
  };
}

export function extractText(response: ClaudeResponse): string {
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('No text block in Claude response');
  return block.text;
}
