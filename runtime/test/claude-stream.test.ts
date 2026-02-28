import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callClaudeStream, type ClaudeStreamEvent } from '../src/lib/claude.js';

// Helper: build an SSE ReadableStream from lines
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + '\n'));
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

// Helper: collect all events from async generator
async function collect(gen: AsyncGenerator<ClaudeStreamEvent>): Promise<ClaudeStreamEvent[]> {
  const events: ClaudeStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe('callClaudeStream', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('yields content_delta events and message_complete', async () => {
    const sseLines = [
      'data: {"type":"message_start","message":{"id":"msg_01","model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hei"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" verden"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
      'data: [DONE]',
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: sseStream(sseLines),
    } as unknown as Response);

    const events = await collect(
      callClaudeStream('test-key', {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hei' }],
      }),
    );

    const deltas = events.filter((e) => e.type === 'content_delta');
    expect(deltas).toHaveLength(2);
    expect((deltas[0] as { text: string }).text).toBe('Hei');
    expect((deltas[1] as { text: string }).text).toBe(' verden');

    const complete = events.find((e) => e.type === 'message_complete');
    expect(complete).toBeDefined();
    if (complete?.type === 'message_complete') {
      expect(complete.response.id).toBe('msg_01');
      expect(complete.response.content[0].text).toBe('Hei verden');
      expect(complete.response.stop_reason).toBe('end_turn');
      expect(complete.response.usage.input_tokens).toBe(100);
      expect(complete.response.usage.output_tokens).toBe(5);
    }
  });

  it('yields error on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    } as unknown as Response);

    const events = await collect(
      callClaudeStream('test-key', {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hei' }],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') {
      expect(events[0].error).toContain('429');
    }
  });

  it('yields error when response has no body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: null,
    } as unknown as Response);

    const events = await collect(
      callClaudeStream('test-key', {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hei' }],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  it('handles partial line buffering across chunks', async () => {
    const encoder = new TextEncoder();
    // Split an SSE line across two chunks
    const part1 = 'data: {"type":"message_start","message":{"id":"msg_02","model":"test","usage":{"input_tokens":10}}}\n';
    const part2a = 'data: {"type":"content_block_del';
    const part2b = 'ta","index":0,"delta":{"type":"text_delta","text":"OK"}}\n';
    const part3 = 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n';

    const chunks = [
      encoder.encode(part1),
      encoder.encode(part2a),
      encoder.encode(part2b),
      encoder.encode(part3),
    ];
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(chunks[i++]);
        } else {
          controller.close();
        }
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body,
    } as unknown as Response);

    const events = await collect(
      callClaudeStream('test-key', {
        model: 'test',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'test' }],
      }),
    );

    const deltas = events.filter((e) => e.type === 'content_delta');
    expect(deltas).toHaveLength(1);
    expect((deltas[0] as { text: string }).text).toBe('OK');

    const complete = events.find((e) => e.type === 'message_complete');
    expect(complete).toBeDefined();
    if (complete?.type === 'message_complete') {
      expect(complete.response.content[0].text).toBe('OK');
    }
  });

  it('sends cache_control headers and system blocks when provided', async () => {
    const sseLines = [
      'data: {"type":"message_start","message":{"id":"msg_03","model":"test","usage":{"input_tokens":10,"cache_read_input_tokens":50}}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":0}}',
    ];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: sseStream(sseLines),
    } as unknown as Response);

    await collect(
      callClaudeStream('test-key', {
        model: 'test',
        max_tokens: 1024,
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
        cache_control: { type: 'ephemeral' },
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, opts] = fetchSpy.mock.calls[0];
    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers['anthropic-beta']).toBe('prompt-caching-2024-07-31');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
