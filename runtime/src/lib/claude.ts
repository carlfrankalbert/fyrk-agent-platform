export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ClaudeMessage[];
}

export interface ClaudeResponse {
  id: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function callClaude(
  apiKey: string,
  request: ClaudeRequest,
): Promise<ClaudeResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<ClaudeResponse>;
}

export function extractText(response: ClaudeResponse): string {
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('No text block in Claude response');
  return block.text;
}
