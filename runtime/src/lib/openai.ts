export interface OpenAiInputItem {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAiRequest {
  model: string;
  input: OpenAiInputItem[];
  max_output_tokens?: number;
  text?: {
    format?: {
      type: 'text' | 'json_schema' | 'json_object';
      name?: string;
      description?: string;
      schema?: Record<string, unknown>;
      strict?: boolean;
    };
  };
}

export interface OpenAiResponse {
  id: string;
  model: string;
  output?: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export async function callOpenAi(
  apiKey: string,
  request: OpenAiRequest,
): Promise<OpenAiResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };

  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  const MAX_RETRIES = 3;
  const jsonBody = JSON.stringify(request);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers,
      body: jsonBody,
    });

    if (res.ok) {
      return res.json() as Promise<OpenAiResponse>;
    }

    const resBody = await res.text();

    if (attempt < MAX_RETRIES && RETRYABLE.has(res.status)) {
      const retryAfter = res.headers.get('retry-after');
      const delayMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000) : 1000 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    throw new Error(`OpenAI API error ${res.status}: ${resBody}`);
  }

  throw new Error('OpenAI API: max retries exceeded');
}

export function extractOpenAiText(response: OpenAiResponse): string {
  if (response.output_text) {
    return response.output_text;
  }

  const chunks: string[] = [];

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) {
        chunks.push(content.text);
      }
    }
  }

  if (chunks.length === 0) {
    throw new Error('No output_text content in OpenAI response');
  }

  return chunks.join('');
}

export function extractOpenAiRefusal(response: OpenAiResponse): string | null {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'refusal' && content.refusal) {
        return content.refusal;
      }
    }
  }

  return null;
}
