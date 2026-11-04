import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateEnv } from '../src/lib/env.js';
import { verifySignature } from '../src/lib/slack.js';
import { buildHttpRequest } from '../src/lib/claude.js';
import { classifyEvent, stripMention, type SlackEnvelope } from '../src/slack-bot/events.js';
import { claimEvent, cleanupClaims, resetCleanupThrottle } from '../src/slack-bot/dedup.js';
import { processEvent, slackBotRoutes, SLACK_BOT_EVENTS_PATH } from '../src/slack-bot/routes.js';
import { buildMessages, buildSystemBlocks, ERROR_MSG, handleBotEvent, PLACEHOLDER_MSG } from '../src/slack-bot/conversation.js';
import { selectModule } from '../src/slack-bot/select.js';
import { getModule, listModules } from '../src/slack-bot/modules/registry.js';
import { HANDBOOK_INSTRUCTIONS, HANDBOOK_MODEL, HANDBOOK_PATH, handbookModule } from '../src/slack-bot/modules/handbook/index.js';
import type { SlackBotEvent } from '../src/slack-bot/types.js';

const SECRET = 'test-signing-secret';
const BOT_USER = 'UBOT123';
const silent = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function sign(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): Record<string, string> {
  const hmac = createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return { 'x-slack-signature': `v0=${hmac}`, 'x-slack-request-timestamp': String(timestamp) };
}

function envelope(event: Record<string, unknown>, extra: Record<string, unknown> = {}): SlackEnvelope {
  return {
    type: 'event_callback',
    event_id: 'Ev001',
    authorizations: [{ user_id: BOT_USER }],
    event,
    ...extra,
  };
}

const mention = { type: 'app_mention', user: 'U1', text: `<@${BOT_USER}> Hvor mange velferdsdager har jeg?`, ts: '1700000000.000100', channel: 'C1' };
const dm = { type: 'message', channel_type: 'im', user: 'U1', text: 'Hva er reglene for egenmelding?', ts: '1700000000.000200', channel: 'D1' };

/** Minimal Supabase stand-in for the dedup table */
function fakeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const upsert = vi.fn(() => ({ select: vi.fn(() => Promise.resolve(result)) }));
  const lt = vi.fn(() => Promise.resolve({ error: null }));
  const del = vi.fn(() => ({ lt }));
  const from = vi.fn(() => ({ upsert, delete: del }));
  return { client: { from } as unknown as SupabaseClient, from, upsert, del, lt };
}

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.SLACK_FYRK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_FYRK_SIGNING_SECRET = SECRET;
  process.env.SLACK_BOT_CHANNEL_MODULES = '{"C_OVERRIDE":"handbook"}';
  validateEnv();
});

describe('verifySignature', () => {
  const body = '{"type":"event_callback"}';

  it('accepts a correctly signed request', () => {
    expect(verifySignature(SECRET, sign(body), body)).toBe(true);
  });

  it('rejects a wrong secret, a tampered body and missing headers', () => {
    expect(verifySignature(SECRET, sign(body, 'other-secret'), body)).toBe(false);
    expect(verifySignature(SECRET, sign(body), body + ' ')).toBe(false);
    expect(verifySignature(SECRET, {}, body)).toBe(false);
  });

  it('rejects timestamps older than 5 minutes (replay)', () => {
    const old = Math.floor(Date.now() / 1000) - 301;
    expect(verifySignature(SECRET, sign(body, SECRET, old), body)).toBe(false);
  });

  it('returns false instead of throwing on signatures of the wrong length', () => {
    const headers = { ...sign(body), 'x-slack-signature': 'v0=short' };
    expect(verifySignature(SECRET, headers, body)).toBe(false);
  });
});

describe('classifyEvent', () => {
  it('handles app_mention and strips the bot mention', () => {
    const result = classifyEvent(envelope(mention));
    expect(result).toEqual({
      handle: true,
      event: expect.objectContaining({
        eventId: 'Ev001', type: 'app_mention', channel: 'C1', user: 'U1',
        text: 'Hvor mange velferdsdager har jeg?', ts: mention.ts, threadTs: undefined, botUserId: BOT_USER,
      }),
    });
  });

  it('handles direct messages (message.im) and keeps thread_ts for follow-ups', () => {
    const result = classifyEvent(envelope({ ...dm, thread_ts: '1700000000.000001' }));
    expect(result.handle && result.event).toMatchObject({ type: 'message', channel: 'D1', threadTs: '1700000000.000001' });
  });

  it.each([
    ['bot messages', { ...dm, bot_id: 'B1' }],
    ['message subtypes', { ...dm, subtype: 'message_changed' }],
    ['bot_message subtype', { ...dm, subtype: 'bot_message' }],
    ['other event types', { ...dm, type: 'reaction_added' }],
    ['messages without user', { ...dm, user: undefined }],
    ['a bare mention with no question', { ...mention, text: `<@${BOT_USER}>` }],
  ])('ignores %s', (_label, event) => {
    expect(classifyEvent(envelope(event)).handle).toBe(false);
  });

  it('handles replies in channel and private-channel threads without a mention, pending a thread check', () => {
    for (const channel_type of ['channel', 'group']) {
      const result = classifyEvent(envelope({ ...dm, channel_type, channel: 'C1', thread_ts: '1700000000.000001' }));
      expect(result.handle && result.event, channel_type).toMatchObject({ type: 'message', threadTs: '1700000000.000001', requireBotInThread: true });
    }
    const direct = classifyEvent(envelope(mention));
    expect(direct.handle && direct.event.requireBotInThread).toBeFalsy();
  });

  it.each([
    ['top-level channel messages', { ...dm, channel_type: 'channel', channel: 'C1' }],
    ['thread parents (thread_ts === ts)', { ...dm, channel_type: 'channel', channel: 'C1', thread_ts: dm.ts }],
    ['channel thread replies that mention the bot (app_mention answers those)', { ...dm, channel_type: 'channel', channel: 'C1', thread_ts: '1', text: `<@${BOT_USER}> og så?` }],
  ])('ignores %s', (_label, event) => {
    expect(classifyEvent(envelope(event)).handle).toBe(false);
  });

  it('ignores channel thread replies when the bot user is unknown', () => {
    const event = { ...dm, channel_type: 'channel', channel: 'C1', thread_ts: '1' };
    expect(classifyEvent(envelope(event, { authorizations: undefined })).handle).toBe(false);
  });

  it('ignores envelopes that are not event_callback or lack event_id', () => {
    expect(classifyEvent(envelope(dm, { type: 'app_rate_limited' })).handle).toBe(false);
    expect(classifyEvent(envelope(dm, { event_id: undefined })).handle).toBe(false);
  });

  it('only strips the bot mention, not other users', () => {
    expect(stripMention(`<@${BOT_USER}> spør <@U2>\nom ferie`, BOT_USER)).toBe('spør <@U2>\nom ferie');
  });
});

describe('POST /slack/fyrk-bot-events', () => {
  let app: FastifyInstance;
  const handleEvent = vi.fn(() => Promise.resolve());
  let supa = fakeSupabase({ data: [{ event_id: 'Ev001' }], error: null });

  beforeAll(async () => {
    app = Fastify();
    await app.register(slackBotRoutes, { getSupabase: () => supa.client, handleEvent });
    await app.ready();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    handleEvent.mockClear();
    supa = fakeSupabase({ data: [{ event_id: 'Ev001' }], error: null });
  });

  function post(payload: unknown, headers: Record<string, string> = {}, signWith = SECRET) {
    const body = JSON.stringify(payload);
    return app.inject({
      method: 'POST', url: SLACK_BOT_EVENTS_PATH, payload: body,
      headers: { 'content-type': 'application/json', ...sign(body, signWith), ...headers },
    });
  }

  it('rejects requests with an invalid signature', async () => {
    const res = await post(envelope(mention), {}, 'wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('answers url_verification with the challenge', async () => {
    const res = await post({ type: 'url_verification', challenge: 'abc123', token: 'x' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ challenge: 'abc123' });
  });

  it('acks immediately and handles a mention asynchronously after claiming the event', async () => {
    const res = await post(envelope(mention));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await vi.waitFor(() => expect(handleEvent).toHaveBeenCalledTimes(1));
    expect(supa.upsert).toHaveBeenCalledWith({ event_id: 'Ev001' }, { onConflict: 'event_id', ignoreDuplicates: true });
    const [event, deps] = handleEvent.mock.calls[0] as unknown as [SlackBotEvent, { botToken: string }];
    expect(event).toMatchObject({ channel: 'C1', text: 'Hvor mange velferdsdager har jeg?' });
    expect(deps.botToken).toBe('xoxb-test');
  });

  it('acks but ignores Slack retries', async () => {
    const res = await post(envelope(mention), { 'x-slack-retry-num': '1', 'x-slack-retry-reason': 'http_timeout' });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(handleEvent).not.toHaveBeenCalled();
    expect(supa.from).not.toHaveBeenCalled();
  });

  it('acks but ignores bot messages and subtypes', async () => {
    expect((await post(envelope({ ...dm, bot_id: 'B1' }))).statusCode).toBe(200);
    expect((await post(envelope({ ...dm, subtype: 'message_deleted' }))).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('does not answer an event another machine already claimed', async () => {
    supa = fakeSupabase({ data: [], error: null });
    expect((await post(envelope(mention))).statusCode).toBe(200);
    await vi.waitFor(() => expect(supa.upsert).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(handleEvent).not.toHaveBeenCalled();
  });
});

describe('event dedup', () => {
  const event = { eventId: 'Ev9' } as SlackBotEvent;

  it('claimEvent returns true for a new event and false for a conflict', async () => {
    expect(await claimEvent(fakeSupabase({ data: [{ event_id: 'Ev9' }], error: null }).client, 'Ev9')).toBe(true);
    expect(await claimEvent(fakeSupabase({ data: [], error: null }).client, 'Ev9')).toBe(false);
  });

  it('claimEvent throws on database errors', async () => {
    await expect(claimEvent(fakeSupabase({ data: null, error: { message: 'boom' } }).client, 'Ev9')).rejects.toThrow(/boom/);
  });

  it('processEvent fails open when the dedup table is unavailable', async () => {
    const handle = vi.fn(() => Promise.resolve());
    await processEvent(event, fakeSupabase({ data: null, error: { message: 'down' } }).client, handle, silent);
    expect(handle).toHaveBeenCalledWith(event);
  });

  it('cleanupClaims deletes rows older than an hour, throttled', async () => {
    resetCleanupThrottle();
    const supa = fakeSupabase({ data: [], error: null });
    const now = Date.parse('2026-11-04T12:00:00Z');
    await cleanupClaims(supa.client, now);
    await cleanupClaims(supa.client, now + 1000);
    expect(supa.lt).toHaveBeenCalledTimes(1);
    expect(supa.lt).toHaveBeenCalledWith('claimed_at', '2026-11-04T11:00:00.000Z');
  });

  describe('migration (PGlite)', () => {
    let db: PGlite;
    beforeAll(async () => {
      db = new PGlite();
      await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        grant usage on schema public to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
      await db.exec(readFileSync(new URL('../../supabase/migrations/20261104120000_slack_bot_event_dedup.sql', import.meta.url), 'utf8'));
    });
    afterAll(() => db.close());

    it('claims each event_id once', async () => {
      const claim = (id: string) => db.query(`insert into slack_bot_event_dedup(event_id) values ($1) on conflict do nothing returning event_id`, [id]);
      expect((await claim('Ev1')).rows).toHaveLength(1);
      expect((await claim('Ev1')).rows).toHaveLength(0);
      const { rows } = await db.query<{ claimed_at: Date }>(`select claimed_at from slack_bot_event_dedup where event_id = 'Ev1'`);
      expect(rows[0].claimed_at).toBeInstanceOf(Date);
    });

    it('is locked to service_role (RLS on, no anon/authenticated grants)', async () => {
      const { rows: [rls] } = await db.query<{ on: boolean }>(`select relrowsecurity as on from pg_class where oid = 'public.slack_bot_event_dedup'::regclass`);
      expect(rls.on).toBe(true);
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await db.query(`select has_table_privilege($1, 'public.slack_bot_event_dedup', 'SELECT') s,
          has_table_privilege($1, 'public.slack_bot_event_dedup', 'INSERT') i`, [role]);
        expect(rows[0], role).toEqual({ s: false, i: false });
      }
      await db.exec('set role service_role');
      try {
        expect((await db.query(`select * from slack_bot_event_dedup`)).rows.length).toBeGreaterThan(0);
      } finally {
        await db.exec('reset role');
      }
    });
  });
});

describe('prompt building', () => {
  it('handbook module: instructions + full handbook as context', async () => {
    const prompt = await handbookModule.buildSystemPrompt();
    expect(handbookModule.model).toBe('claude-sonnet-5-5');
    expect(HANDBOOK_MODEL).toBe('claude-sonnet-5-5');
    expect(prompt.instructions).toBe(HANDBOOK_INSTRUCTIONS);
    expect(prompt.instructions).toMatch(/punktnummer/);
    expect(prompt.instructions).toMatch(/nærmeste leder eller personalavdelingen/);
    expect(prompt.instructions).toMatch(/mrkdwn/);
    const handbook = readFileSync(HANDBOOK_PATH, 'utf8').trim();
    expect(prompt.context).toBe(`<personalhandbok>\n${handbook}\n</personalhandbok>`);
  });

  it('handbook markdown keeps point numbers as headings and drops header, footer and TOC', () => {
    const md = readFileSync(HANDBOOK_PATH, 'utf8');
    expect(md).toMatch(/^## 9\.16 Tilrettelegging$/m);
    expect(md).toMatch(/^# 9 Om fravær ved sykdom$/m);
    expect(md).toMatch(/^## 13\.2 Ulykkes- og yrkesskadeforsikring$/m);
    for (let ch = 1; ch <= 13; ch++) expect(md, `chapter ${ch}`).toMatch(new RegExp(`^# ${ch} `, 'm'));
    expect(md).not.toMatch(/\.{10,}/); // TOC leader dots
    expect(md).not.toMatch(/Vedtatt september 2025/); // page footer
    expect(md).not.toMatch(/^Innhold$/m);
  });

  it('puts cache_control on the context block only', () => {
    expect(buildSystemBlocks({ instructions: 'I', context: 'C' })).toEqual([
      { type: 'text', text: 'I' },
      { type: 'text', text: 'C', cache_control: { type: 'ephemeral' } },
    ]);
    expect(buildSystemBlocks({ instructions: 'I' })).toEqual([{ type: 'text', text: 'I' }]);
  });

  it('sends system blocks unchanged to the Messages API', () => {
    const system = buildSystemBlocks({ instructions: 'I', context: 'C' });
    const { headers, body } = buildHttpRequest('k', { model: HANDBOOK_MODEL, max_tokens: 10, system, messages: [] });
    expect(body.system).toEqual(system);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(headers['anthropic-beta']).toBeDefined();
    expect(buildHttpRequest('k', { model: 'm', max_tokens: 1, system: 'plain', messages: [] }).body.system).toBe('plain');
  });

  it('builds messages from thread history for follow-up questions', () => {
    const current = { text: 'Og hvis barnet er sykt?', ts: '5', botUserId: BOT_USER };
    const messages = buildMessages([
      { user: 'U1', text: `<@${BOT_USER}> Hvor lenge kan jeg bruke egenmelding?`, ts: '1' },
      { user: BOT_USER, bot_id: 'B1', text: PLACEHOLDER_MSG, ts: '2' },
      { user: BOT_USER, bot_id: 'B1', text: 'Inntil 8 kalenderdager (pkt. 9.4).', ts: '3' },
      { user: 'UOTHER', bot_id: 'B2', text: 'Annen bot', ts: '4' },
      { user: BOT_USER, bot_id: 'B1', text: ERROR_MSG, ts: '4.5' },
      { user: 'U1', text: 'Og hvis barnet er sykt?', ts: '5' }, // current message, also in history
    ], current);
    expect(messages).toEqual([
      { role: 'user', content: 'Hvor lenge kan jeg bruke egenmelding?' },
      { role: 'assistant', content: 'Inntil 8 kalenderdager (pkt. 9.4).' },
      { role: 'user', content: 'Og hvis barnet er sykt?' },
    ]);
  });

  it('merges consecutive user turns and never starts with the assistant', () => {
    const messages = buildMessages([
      { user: BOT_USER, bot_id: 'B1', text: 'Tidligere svar', ts: '1' },
      { user: 'U2', text: 'Kommentar', ts: '2' },
    ], { text: 'Spørsmål', ts: '3', botUserId: BOT_USER });
    expect(messages).toEqual([{ role: 'user', content: 'Kommentar\n\nSpørsmål' }]);
  });
});

describe('module selection', () => {
  it('registers the handbook module', () => {
    expect(listModules()).toContain('handbook');
    expect(getModule('handbook')).toBe(handbookModule);
  });

  it('uses the default module, with per-channel overrides', () => {
    expect(selectModule({ channel: 'C1' }).id).toBe('handbook'); // from env defaults
    const config = { defaultModule: 'handbook', channelModules: { C9: 'missing' } };
    expect(selectModule({ channel: 'C1' }, config).id).toBe('handbook');
    expect(() => selectModule({ channel: 'C9' }, config)).toThrow(/"missing" is not registered/);
  });
});

describe('handleBotEvent', () => {
  const event: SlackBotEvent = {
    eventId: 'Ev1', type: 'app_mention', channel: 'C1', user: 'U1', text: 'Hva med tilrettelegging?',
    ts: '1700000000.000100', botUserId: BOT_USER,
  };

  function sse(lines: string[]): Response {
    return new Response(lines.map((l) => `data: ${l}\n`).join(''), { status: 200 });
  }

  function mockFetch(claude: () => Response) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} });
      if (url.includes('api.anthropic.com')) return Promise.resolve(claude());
      if (url.includes('conversations.replies')) return Promise.resolve(Response.json({ ok: true, messages: [] }));
      return Promise.resolve(Response.json({ ok: true, ts: '1700000000.000999' }));
    });
    return calls;
  }

  beforeEach(() => vi.restoreAllMocks());

  it('posts a placeholder in the thread, streams the answer and logs module + cache usage', async () => {
    const calls = mockFetch(() => sse([
      '{"type":"message_start","message":{"id":"m","model":"claude-sonnet-5-5","usage":{"input_tokens":12,"cache_read_input_tokens":30000,"cache_creation_input_tokens":0}}}',
      '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Leder skal vurdere "}}',
      '{"type":"content_block_delta","delta":{"type":"text_delta","text":"tilrettelegging (pkt. 9.16)."}}',
      '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}',
    ]));
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await handleBotEvent(event, { botToken: 'xoxb', apiKey: 'sk', selectModule: () => handbookModule, logger });

    const post = calls.find((c) => c.url.includes('chat.postMessage'))!;
    expect(post.body).toMatchObject({ channel: 'C1', thread_ts: event.ts, text: PLACEHOLDER_MSG });
    const claude = calls.find((c) => c.url.includes('api.anthropic.com'))!;
    expect(claude.body.model).toBe('claude-sonnet-5-5');
    expect((claude.body.system as Array<{ cache_control?: unknown }>)[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(claude.body.messages).toEqual([{ role: 'user', content: 'Hva med tilrettelegging?' }]);
    const updates = calls.filter((c) => c.url.includes('chat.update'));
    expect(updates.at(-1)!.body).toMatchObject({ ts: '1700000000.000999', text: 'Leder skal vurdere tilrettelegging (pkt. 9.16).' });
    expect(calls.some((c) => c.url.includes('conversations.replies'))).toBe(false); // not a follow-up
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
      module: 'handbook', input_tokens: 12, output_tokens: 20, cache_read_input_tokens: 30000, cache_hit: true,
    }), 'Slack bot answered');
  });

  it('loads thread history for follow-up questions', async () => {
    const calls = mockFetch(() => sse(['{"type":"content_block_delta","delta":{"type":"text_delta","text":"Svar"}}']));
    await handleBotEvent({ ...event, threadTs: '1700000000.000001' }, { botToken: 'xoxb', apiKey: 'sk', selectModule: () => handbookModule, logger: silent });
    expect(calls.find((c) => c.url.includes('conversations.replies'))!.url).toContain('ts=1700000000.000001');
    expect(calls.find((c) => c.url.includes('chat.postMessage'))!.body.thread_ts).toBe('1700000000.000001');
  });

  it('replaces the placeholder with a short error message when Claude fails', async () => {
    const calls = mockFetch(() => new Response('overloaded', { status: 529 }));
    await handleBotEvent(event, { botToken: 'xoxb', apiKey: 'sk', selectModule: () => handbookModule, logger: silent });
    expect(calls.filter((c) => c.url.includes('chat.update')).at(-1)!.body.text).toBe(ERROR_MSG);
  });

  describe('un-mentioned channel thread replies', () => {
    const reply: SlackBotEvent = { ...event, type: 'message', threadTs: '1700000000.000001', requireBotInThread: true, text: 'Og ved deltid?' };

    function mockWithHistory(messages: unknown[]) {
      const calls = mockFetch(() => sse(['{"type":"content_block_delta","delta":{"type":"text_delta","text":"Forholdsmessig (pkt. 2.5)."}}']));
      const base = vi.mocked(globalThis.fetch).getMockImplementation()!;
      vi.mocked(globalThis.fetch).mockImplementation((input, init) => String(input).includes('conversations.replies')
        ? (calls.push({ url: String(input), body: {} }), Promise.resolve(Response.json({ ok: true, messages })))
        : base(input, init));
      return calls;
    }

    it('answers when the bot has already replied in the thread', async () => {
      const calls = mockWithHistory([
        { user: 'U1', text: `<@${BOT_USER}> Får jeg funksjonstillegg?`, ts: '1700000000.000001' },
        { user: BOT_USER, bot_id: 'B1', text: 'Ja, se pkt. 2.5.', ts: '1700000000.000002' },
      ]);
      await handleBotEvent(reply, { botToken: 'xoxb', apiKey: 'sk', selectModule: () => handbookModule, logger: silent });
      expect(calls.find((c) => c.url.includes('chat.postMessage'))!.body).toMatchObject({ thread_ts: reply.threadTs, text: PLACEHOLDER_MSG });
      const claude = calls.find((c) => c.url.includes('api.anthropic.com'))!;
      expect(claude.body.messages).toEqual([
        { role: 'user', content: 'Får jeg funksjonstillegg?' },
        { role: 'assistant', content: 'Ja, se pkt. 2.5.' },
        { role: 'user', content: 'Og ved deltid?' },
      ]);
    });

    it('stays silent in threads the bot is not part of', async () => {
      const calls = mockWithHistory([
        { user: 'U2', text: 'Noen som vet?', ts: '1700000000.000001' },
        { user: 'UOTHER', bot_id: 'B2', text: 'Annen bot', ts: '1700000000.000002' },
      ]);
      await handleBotEvent(reply, { botToken: 'xoxb', apiKey: 'sk', selectModule: () => handbookModule, logger: silent });
      expect(calls.map((c) => c.url)).toEqual([expect.stringContaining('conversations.replies')]);
    });

    it('stays silent (no error message) when the thread history cannot be loaded', async () => {
      const calls = mockFetch(() => sse([]));
      vi.mocked(globalThis.fetch).mockImplementation((input) => {
        calls.push({ url: String(input), body: {} });
        return Promise.resolve(Response.json({ ok: false, error: 'missing_scope' }));
      });
      await handleBotEvent(reply, { botToken: 'xoxb', apiKey: 'sk', selectModule: () => handbookModule, logger: silent });
      expect(calls.map((c) => c.url)).toEqual([expect.stringContaining('conversations.replies')]);
    });
  });

  it('posts the error in the thread when no module can be selected', async () => {
    const calls = mockFetch(() => sse([]));
    await handleBotEvent(event, { botToken: 'xoxb', apiKey: 'sk', selectModule: () => { throw new Error('nope'); }, logger: silent });
    expect(calls.map((c) => c.url)).toEqual(['https://slack.com/api/chat.postMessage']);
    expect(calls[0].body).toMatchObject({ thread_ts: event.ts, text: ERROR_MSG });
  });
});
