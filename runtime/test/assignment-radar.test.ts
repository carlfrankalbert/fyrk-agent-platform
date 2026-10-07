import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalize, canonicalUrl, dateValue } from '../src/agents/assignment-radar/normalize.js';
import { InputSchema, ProfileSchema, type StoredAssignment } from '../src/agents/assignment-radar/schemas.js';
import { scoreAssignment } from '../src/agents/assignment-radar/score.js';
import { duplicateReason, findDuplicate } from '../src/agents/assignment-radar/dedup.js';
import { executeRadar } from '../src/agents/assignment-radar/index.js';
import type { RadarStore } from '../src/agents/assignment-radar/store.js';
import type { SourceAdapter } from '../src/agents/assignment-radar/sources/common.js';
import { icAdapter, parseIc } from '../src/agents/assignment-radar/sources/ic.js';
import { omegaAdapter, parseOmega } from '../src/agents/assignment-radar/sources/omega365.js';
import { konsAdapter, parseKons } from '../src/agents/assignment-radar/sources/kons.js';
import { forteAdapter, parseForte } from '../src/agents/assignment-radar/sources/fortehub.js';
import { folqAdapter, parseFolq } from '../src/agents/assignment-radar/sources/folq.js';
import { slackText, SlackRejected } from '../src/agents/assignment-radar/slack.js';
import Fastify from 'fastify';
import { runRoutes } from '../src/routes/run.js';
import { validateEnv } from '../src/lib/env.js';
import { SupabaseRadarStore } from '../src/agents/assignment-radar/store.js';
import { adapters } from '../src/agents/assignment-radar/sources/index.js';
import { getAgent } from '../src/agents/registry.js';

const now = '2026-09-30T01:00:00.000Z';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/assignment-radar/${name}`, import.meta.url), 'utf8');
const profile = ProfileSchema.parse({});
const assignment = (changes = {}) => normalize('ic', { external_id: 'a', url: 'https://www.ic.no/oppdrag/a',
  title: 'Senior produktleder mobilbank', customer: 'DNB', location: 'Oslo',
  deadline: '2026-10-15', start_date: '2026-11-01', extent: '100%',
  description: 'Bank betaling smidig tverrfaglig produktledelse. Skal-krav\nCSPO\nBør-krav\nISTQB Test Manager', ...changes }, now);
const record = (changes = {}): StoredAssignment => { const a = assignment(changes); return { id: '1', assignment: a, observations: [a], score: scoreAssignment(a, profile) }; };

class MemoryStore implements RadarStore {
  records = new Map<string, StoredAssignment>();
  deliveries = new Map<string, string>();
  locked = false;
  async acquire() { if (this.locked) return false; this.locked = true; return true; }
  async release() { this.locked = false; }
  async list() { return [...this.records.values()].map(r => structuredClone(r)); }
  async save(_token: string, r: StoredAssignment, queueDelivery: boolean) {
    this.records.set(r.id, structuredClone(r));
    // Mirrors the RPC's ON CONFLICT DO NOTHING: an existing delivery keeps its state.
    if (queueDelivery && !this.deliveries.has(r.id)) this.deliveries.set(r.id, 'pending');
  }
  async pending() { return [...this.deliveries].filter(([, s]) => s === 'pending').map(([id]) => id); }
  async claim(_token: string, id: string) { if (this.deliveries.get(id) !== 'pending') return false; this.deliveries.set(id, 'sending'); return true; }
  async finish(id: string, status: string) { this.deliveries.set(id, status); }
}
const adapter = (source: SourceAdapter['source'], items = [assignment()]): SourceAdapter => ({ source, async fetch() { return { assignments: items, errors: [] }; } });
const slack = () => vi.fn(async () => new Response(JSON.stringify({ ok: true, channel: 'C1', ts: '1.2' })));

 describe('portal adapters (captured public pages, 2026-09-30)', () => {
  it('IC parses streamed RSC details and all required metadata', () => {
    const a = parseIc(fixture('ic.html'), 'https://www.ic.no/oppdrag/testleder', now);
    expect(a.title).toContain('Testleder'); expect(a.customer).toBe('FORSVARSMATERIELL');
    expect(a.start_date).toBe('2027-01-18'); expect(a.extent).toBe('100 %');
    expect(a.description).toContain('Kompetansekrav'); expect(a.description).not.toContain('consentManagerDialog');
  });
  it('Omega parses duration, location, deadline and qualifications', () => {
    const a = parseOmega(fixture('omega.html'), 'https://www.omega365.com/jobs/jobinfo/73253', now);
    expect(a.external_id).toBe('73253'); expect(a.location).toBe('Oslo');
    expect(a.deadline).toBe('2026-10-08'); expect(a.start_date).toBe('2026-09-21');
    expect(a.description).toContain('Requirements');
  });
  it('Kons parses definition-list metadata and full description', () => {
    const a = parseKons(fixture('kons.html'), 'https://www.kons.no/assignment/123', now);
    expect(a.customer).toBe('Statens vegvesen'); expect(a.deadline).toBe('2026-09-28');
    expect(a.extent).toBe('100%'); expect(a.description).toContain('LibreNMS');
  });
  it('Forte parses its real JSON API and excludes archived assignments', () => {
    const list = parseForte(fixture('fortehub.json'), now);
    expect(list.length).toBeGreaterThan(0); expect(list[0].customer).toBe('Forsvarsbygg');
    expect(list[0].url).toContain('/no/assignments/100493/'); expect(list[0].extent).toBe('100%');
    expect(list[0].description).toContain('Skal-krav');
  });
  it('Folq parses the marketplace model, tagged deadlines and remote location', async () => {
    const body = JSON.stringify([{ uuid: 'f1', title: 'Product owner', company: { name: 'Bank' }, isActive: true,
      deadline: { tag: 'DeadlineWithDate', contents: '2026-10-30' }, startDate: '2026-11-01',
      percent: 80, placeDescription: 'Oslo', allowRemoteWork: true, description: '<p>Produktledelse</p>' }]);
    expect(parseFolq(body, now)[0]).toMatchObject({ source: 'folq', deadline: '2026-10-30', extent: '80%', location: 'Oslo / Remote' });
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body)); await folqAdapter('session=secret').fetch(f, now);
    expect((f.mock.calls[0][1]?.headers as Record<string, string>).Cookie).toBe('session=secret');
    await expect(folqAdapter().fetch(f, now)).rejects.toThrow('Access required');
    await expect(folqAdapter('x').fetch(async () => new Response('denied', { status: 401 }), now)).rejects.toThrow('401');
  });
  it.each([[icAdapter, 'ic'], [omegaAdapter, 'omega'], [konsAdapter, 'kons']] as const)('%s crawls list and details, tolerating one failed detail', async (source, name) => {
    let details = 0;
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/oppdrag') || url.endsWith('/jobs') || url.endsWith('/assignments')) return new Response(fixture(`${name}-list.html`));
      details++; if (details === 1) return new Response('failure', { status: 503 });
      return new Response(fixture(`${name === 'omega' ? 'omega' : name}.html`));
    });
    const result = await source.fetch(f, now);
    expect(result.errors).toHaveLength(1); expect(result.assignments.length).toBeGreaterThan(0);
  });
  it('recognizes Omega Norwegian and international job templates', () => {
    const no = parseOmega(fixture('omega-other.html'), 'https://omega365.com/jobs/jobinfo/73373', now);
    expect(no.customer).toBe('Forsvarsbygg'); expect(no.location).toBe('Oslo'); expect(no.deadline).toBe('2026-10-16');
    expect(parseOmega(fixture('omega-global.html'), 'https://omega365.com/jobs/jobinfo/73177', now).description).toContain('Duties and Responsibilities');
  });
  it('extracts Kons start/extent from description when absent from the metadata list', () => {
    const a = parseKons(fixture('kons-product2.html'), 'https://kons.no/assignment/p', now);
    expect(a.start_date).toBe('Snarest'); expect(a.extent).toBe('100%'); expect(a.customer).toBeNull();
    expect(scoreAssignment(a, profile, '2026-09-30').total).toBeGreaterThanOrEqual(70);
  });
  it('Forte fetches its public endpoint and rejects a changed format', async () => {
    const f = vi.fn(async (_url: string) => new Response(fixture('fortehub.json')));
    expect((await forteAdapter.fetch(f, now)).assignments.length).toBeGreaterThan(0);
    expect(f.mock.calls[0][0]).toBe('https://backend.fortehub.no/api/assignments');
    expect(() => parseForte('{}', now)).toThrow();
  });
  it('fails loudly for unexpected empty marketing/login pages', async () => {
    for (const a of [icAdapter, omegaAdapter, konsAdapter]) await expect(a.fetch(async () => new Response('<h1>Login</h1>'), now)).rejects.toThrow('Unrecognized');
  });
});
describe('normalization, scoring and deduplication', () => {
  it('normalizes HTML, date formats, URL tracking and unknown metadata', () => {
    expect(canonicalUrl('https://www.ic.no/oppdrag/1/?utm_source=x&id=2#foo')).toBe('https://ic.no/oppdrag/1?id=2');
    expect(dateValue('18. januar 2027')).toBe('2027-01-18'); expect(dateValue('01.10.2026')).toBe('2026-10-01');
    expect(dateValue('ASAP')).toBe('ASAP'); expect(dateValue(null)).toBeNull();
    expect(assignment({ title: ' <b>Produktleder</b> ' }).title).toBe('Produktleder');
  });
  it('matches the Carl profile while respecting mandatory gaps, extent and expiry', () => {
    expect(scoreAssignment(assignment(), profile, '2026-09-30').total).toBeGreaterThanOrEqual(90);
    const gap = scoreAssignment(assignment({ description: 'Skal-krav\nPMP sertifisering' }), profile, '2026-09-30');
    expect(gap.total).toBeLessThan(70); expect(gap.gaps.join(' ')).toContain('PMP');
    expect(scoreAssignment(assignment({ deadline: '2026-09-20' }), profile, '2026-09-30').relevant).toBe(false);
    expect(scoreAssignment(assignment({ extent: '100%', location: 'Stavanger' }), ProfileSchema.parse({ maxExtent: 80 }), '2026-09-30').breakdown).toMatchObject({ extent: 0, location: 0 });
  });
  it.each(['2026-09-01', '2027-05-01', 'Snarest', null])('ignores start date %s and legacy availability input in relevance and Slack assessments', start_date => {
    const legacyProfile = ProfileSchema.parse({ availableFrom: '2027-01-01' });
    expect(legacyProfile).not.toHaveProperty('availableFrom');
    const a = assignment({ start_date }), score = scoreAssignment(a, legacyProfile, '2026-09-30');
    expect(score).toEqual(scoreAssignment(assignment(), profile, '2026-09-30'));
    expect(score.breakdown).not.toHaveProperty('start');
    const text = slackText({ id: '1', assignment: a, observations: [a], score });
    expect(text).toContain(`Oppstart: ${start_date ?? 'Ikke oppgitt'}`);
    expect(text).not.toMatch(/tilgjengelighet|konfigurert tilgjengelighet/i);
  });
  it('keeps the maximum score at 100 after removing availability', () => {
    expect(scoreAssignment(assignment(), profile, '2026-09-30').total).toBe(100);
  });
  it.each(['produkteier','product manager','testleder','test manager','QA leder','kvalitetsleder','prosjektleder','leveranseleder','delivery manager','produktcoach','rådgiver digitalisering'])('recognizes %s', title => {
    expect(scoreAssignment(assignment({ title }), profile, '2026-09-30').relevant).toBe(true);
  });
  it('filters unrelated and generic advisor roles', () => {
    expect(scoreAssignment(assignment({ title: 'Mechanical Engineer', description: 'Offshore' }), profile).relevant).toBe(false);
    expect(scoreAssignment(assignment({ title: 'Rådgiver', description: 'HMS og bygg' }), profile).relevant).toBe(false);
  });
  it('matches identity and canonical URLs before fuzzy candidates', () => {
    const a = assignment(); expect(duplicateReason(a, { ...a, title: 'Changed' })).toBe('external_id');
    expect(duplicateReason(a, { ...a, source: 'kons', external_id: 'b', url: `${a.url}?utm_source=x` })).toBe('canonical_url');
    const exact = record(); const fuzzy = { ...record(), id: '2', observations: [{ ...a, source: 'kons' as const, external_id: 'c', url: 'https://kons.no/assignment/c' }] };
    expect(findDuplicate(a, [fuzzy, exact])?.record.id).toBe('1');
  });
  it('links cross-portal customer/role/period and rejects separate teams or periods', () => {
    const a = assignment(), b = { ...a, source: 'kons' as const, external_id: 'b', url: 'https://kons.no/assignment/b' };
    expect(duplicateReason(a, b)).toBe('customer_role_period');
    expect(duplicateReason(a, { ...b, start_date: '2027-05-01' })).toBeNull();
    expect(duplicateReason(a, { ...b, customer: 'Annen bank' })).toBeNull();
    expect(duplicateReason(a, { ...b, title: 'Produktleder skadeforsikring', description: 'Ny forsikringsplattform' })).toBeNull();
    expect(duplicateReason({ ...a, customer: null, start_date: null }, { ...b, customer: null, start_date: null })).toBeNull();
  });
  it('does not collapse distinct teams sharing a generic customer/role/start date', () => {
    const a = assignment({ title: 'Produktleder', description: 'Team kortbetaling og fysisk betaling' });
    const b = { ...assignment({ title: 'Produktleder', description: 'Team forsikring og pensjonssystemer' }), source: 'kons' as const, external_id: 'b', url: 'https://kons.no/assignment/b' };
    expect(duplicateReason(a, b)).toBeNull();
  });
  it('links the real Forsvarsbygg assignment across four differently worded portals', () => {
    const observations = [parseIc(fixture('ic.html'), 'https://ic.no/oppdrag/test', now),
      parseKons(fixture('kons-test.html'), 'https://kons.no/assignment/test', now),
      parseOmega(fixture('omega-other.html'), 'https://omega365.com/jobs/jobinfo/73373', now),
      parseForte(fixture('fortehub.json'), now)[0]];
    for (let i = 0; i < observations.length; i++) for (let j = i + 1; j < observations.length; j++) expect(duplicateReason(observations[i], observations[j])).toBe('customer_role_period');
    expect(scoreAssignment(observations[1], profile, '2026-09-30').gaps.join(' ')).toContain('sikkerhetsklareres');
  });
  it('supports strong textual similarity when a customer is unknown', () => {
    const description = 'Vi søker erfaren produktleder til utvikling av digital mobilbank plattform med ansvar for prioritering strategi roadmap kundereiser regulering leveranser kvalitet analyse innsikt testing samarbeid design utviklere forretning kommunikasjon tilgjengelighet sikkerhet betalingsløsninger transaksjoner.';
    const a = assignment({ description, customer: null, start_date: null });
    expect(duplicateReason(a, { ...a, source: 'omega365', external_id: 'x', url: 'https://omega365.com/jobs/jobinfo/1' })).toBe('text');
  });
});
describe('persistent already-seen and delivery orchestration', () => {
  const input = InputSchema.parse({ sources: ['ic', 'kons'], profile });
  const deps = (store: MemoryStore, items = [adapter('ic')]) => ({ store, adapters: items, fetcher: slack(), threshold: 70, dryRun: false, publish: true, slackToken: 'x', slackChannel: 'C1', now });
  it('posts once, attaches a later portal, and preserves observation first_seen_at', async () => {
    const store = new MemoryStore(), d = deps(store);
    expect(await executeRadar(input, d)).toMatchObject({ new: 1, posted: 1 });
    const second = await executeRadar(input, { ...d, now: '2026-10-01T01:00:00.000Z', adapters: [adapter('ic', [{ ...assignment(), last_seen_at: '2026-10-01T01:00:00.000Z' }]), adapter('kons', [{ ...assignment(), source: 'kons', external_id: 'k1', url: 'https://kons.no/assignment/k1' }])] });
    expect(second).toMatchObject({ new: 0, duplicates: 2, posted: 0 });
    const r = [...store.records.values()][0]; expect(r.observations).toHaveLength(2);
    expect(r.observations.find(a => a.source === 'ic')?.first_seen_at).toBe(now);
    expect(d.fetcher).toHaveBeenCalledTimes(1); expect(slackText(r)).toContain('ic, kons');
  });
  it.each(['emagine', 'rightpeoplegroup', 'sperton', '7n'] as const)('stores a later %s observation without posting the existing assignment again', async source => {
    const store = new MemoryStore(), d = deps(store);
    const selected = InputSchema.parse({ sources: ['ic', source] });
    expect(await executeRadar(selected, d)).toMatchObject({ new: 1, posted: 1 });
    const incoming = { ...assignment(), source, external_id: 'new-portal-id', url: `https://example.com/${source}/new-portal-id` };
    expect(await executeRadar(selected, { ...d, adapters: [adapter(source, [incoming])] })).toMatchObject({ new: 0, duplicates: 1, posted: 0 });
    const saved = [...store.records.values()][0];
    expect(saved.observations.map(a => a.source)).toEqual(['ic', source]);
    expect(store.deliveries.get(saved.id)).toBe('sent'); expect(d.fetcher).toHaveBeenCalledTimes(1);
  });
  it('persists filtered assignments and recognizes them on later runs', async () => {
    const store = new MemoryStore(), d = deps(store, [adapter('ic', [assignment({ title: 'Offshore Engineer', description: 'Oil' })])]);
    expect(await executeRadar(input, d)).toMatchObject({ new: 1, filtered: 1, posted: 0 });
    expect(await executeRadar(input, d)).toMatchObject({ new: 0, duplicates: 1, filtered: 1, posted: 0 });
    expect(store.records.size).toBe(1);
  });
  it('keeps successful sources when another fails and reports counts', async () => {
    const bad: SourceAdapter = { source: 'kons', async fetch() { throw new Error('bad'); } };
    expect(await executeRadar(input, deps(new MemoryStore(), [adapter('ic'), bad]))).toMatchObject({ found: 1, new: 1, posted: 1, sources: [{ source: 'ic', found: 1, errors: [] }, { source: 'kons', found: 0, errors: [expect.any(String)] }] });
  });
  it('dryRun and publish:false cause no Slack side effects; pending survives to the next run', async () => {
    const store = new MemoryStore(), d = deps(store);
    await executeRadar(input, { ...d, dryRun: true }); expect(store.records.size).toBe(0); expect(d.fetcher).not.toHaveBeenCalled();
    await executeRadar(input, { ...d, publish: false }); expect(store.records.size).toBe(1); expect(d.fetcher).not.toHaveBeenCalled();
    expect(await executeRadar(input, d)).toMatchObject({ new: 0, posted: 1 });
  });
  it('does not resend an ambiguous Slack delivery', async () => {
    const store = new MemoryStore(), d = deps(store), f = vi.fn(async () => { throw new Error('timeout'); });
    expect((await executeRadar(input, { ...d, fetcher: f })).errors).toHaveLength(1);
    await executeRadar(input, { ...d, fetcher: f }); expect(f).toHaveBeenCalledTimes(1);
    expect([...store.deliveries.values()]).toEqual(['uncertain']);
  });
  it('retries definite Slack rejection and preserves pending without configured Slack', async () => {
    const store = new MemoryStore(), d = deps(store);
    expect((await executeRadar(input, { ...d, slackToken: undefined })).errors).toHaveLength(1);
    const rejected = await executeRadar(input, { ...d, fetcher: async () => new Response('{"ok":false,"error":"channel_not_found"}') });
    expect(rejected.posted).toBe(0);
    expect(rejected.errors).toEqual(['Slack rejected a message (channel_not_found); delivery remains pending.']);
    expect((await executeRadar(input, d)).posted).toBe(1);
  });
  it('does not report arbitrary Slack response content as an error code', () => {
    expect(new SlackRejected('not_in_channel').message).toBe('not_in_channel');
    expect(new SlackRejected('response includes private content').message).toBe('unknown_error');
  });
  it('reads PostgREST timestamps and recognizes persisted observations on the next run', async () => {
    const saved = record();
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ id: saved.id,
      assignment: saved.assignment, score: saved.score,
      assignment_radar_observations: [{ ...saved.assignment,
        first_seen_at: '2026-09-30T03:00:00+02:00', last_seen_at: '2026-09-30T01:00:00.000+00:00' }],
    }]), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const store = new SupabaseRadarStore('https://example.supabase.co', 'test');
      const records = await store.list();
      expect(records[0].observations[0].first_seen_at).toBe(now);
      expect(records[0].observations[0].last_seen_at).toBe(now);
      expect(findDuplicate(assignment(), records)?.record.id).toBe(saved.id);
      const memory = new MemoryStore(); memory.records.set(saved.id, records[0]);
      expect(await executeRadar(input, { ...deps(memory), publish: false })).toMatchObject({ new: 0, duplicates: 1 });
    } finally { vi.unstubAllGlobals(); }
  });
  it('uses eight active sources and rejects deferred Folq in API input', () => {
    const active = ['ic', 'omega365', 'kons', 'fortehub', 'emagine', 'rightpeoplegroup', 'sperton', '7n'];
    expect(InputSchema.parse({}).sources).toEqual(active);
    expect(adapters().map(a => a.source)).toEqual(active);
    expect(InputSchema.safeParse({ sources: ['folq'] }).success).toBe(false);
  });
  it('blocks concurrent runs and is registered through the existing API registry', async () => {
    const store = new MemoryStore(); store.locked = true;
    await expect(executeRadar(input, deps(store))).rejects.toThrow('already running');
    expect(getAgent('assignment-radar')?.inputSchema.parse({})).toMatchObject({ sources: expect.arrayContaining(['ic','fortehub']) });
  });
});

describe('existing agent API', () => {
  it('runs POST /run/assignment-radar with the established request envelope', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_KEY', 'test');
    const operatorToken = 'radar-test-operator-token-0123456789';
    vi.stubEnv('AGENT_OPERATOR_TOKEN', operatorToken);
    validateEnv();
    const read = vi.spyOn(SupabaseRadarStore.prototype, 'list').mockResolvedValue([]);
    const write = vi.spyOn(SupabaseRadarStore.prototype, 'save');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fixture('fortehub.json'))));
    const app = Fastify(); await app.register(runRoutes);
    try {
      const payload = { input: { sources: ['fortehub'] }, dryRun: true, publish: true };
      const denied = await app.inject({ method: 'POST', url: '/run/assignment-radar', payload });
      expect(denied.statusCode).toBe(401); expect(read).not.toHaveBeenCalled();
      const r = await app.inject({ method: 'POST', url: '/run/assignment-radar', payload, headers: { 'x-operator-token': operatorToken } });
      expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ agentName: 'assignment-radar', status: 'ok', output: { found: 2, posted: 0 } });
      expect(read).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
    } finally { await app.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});

describe('delivery queueing for assignments that qualify after first sighting', () => {
  const base = InputSchema.parse({ sources: ['ic'], profile });
  const listing = () => assignment({ location: 'Bergen' }); // relevant, but scores below 100 so a higher threshold exists
  const score = scoreAssignment(listing(), profile).total;
  const above = { ...base, threshold: 70 };
  const below = { ...base, threshold: Math.min(100, score + 1) };
  const deps = (store: MemoryStore) => ({ store, adapters: [adapter('ic', [listing()])], fetcher: slack(), threshold: 70, dryRun: false, publish: true, slackToken: 'x', slackChannel: 'C1', now });

  it('fixture assignment is relevant and scores between the two thresholds', () => {
    expect(scoreAssignment(listing(), profile).relevant).toBe(true);
    expect(score).toBeGreaterThanOrEqual(70);
    expect(score).toBeLessThan(below.threshold ?? 0);
  });

  it('1-3/5/6: queued once when it later qualifies, kept pending without publish, sent exactly once', async () => {
    const store = new MemoryStore(), d = deps(store);
    expect(await executeRadar(below, { ...d, publish: false })).toMatchObject({ new: 1, filtered: 1, posted: 0 });
    expect(store.records.size).toBe(1); expect(store.deliveries.size).toBe(0);                 // 1: below threshold → no delivery
    const id = [...store.records.keys()][0];

    expect(await executeRadar(above, { ...d, publish: false })).toMatchObject({ new: 0, duplicates: 1, filtered: 0, posted: 0 });
    expect([...store.deliveries]).toEqual([[id, 'pending']]);                                  // 2: now qualifies → exactly one
    expect(await executeRadar(above, { ...d, publish: false })).toMatchObject({ posted: 0 });
    expect([...store.deliveries]).toEqual([[id, 'pending']]);                                  // 3: still exactly one
    expect(d.fetcher).not.toHaveBeenCalled();                                                  // 5: publish:false sends nothing

    expect(await executeRadar(above, d)).toMatchObject({ posted: 1 });                          // 6: publish:true sends once
    expect([...store.deliveries]).toEqual([[id, 'sent']]);
    expect(d.fetcher).toHaveBeenCalledTimes(1);
  });

  it('4: an already sent assignment that keeps qualifying is never reposted', async () => {
    const store = new MemoryStore(), d = deps(store);
    expect(await executeRadar(above, d)).toMatchObject({ new: 1, posted: 1 });
    for (let i = 0; i < 3; i++) expect(await executeRadar(above, d)).toMatchObject({ posted: 0 });
    expect([...store.deliveries.values()]).toEqual(['sent']);
    expect(d.fetcher).toHaveBeenCalledTimes(1);
  });

  it('E: sending/uncertain deliveries keep their state and are not duplicated or retried', async () => {
    for (const state of ['sending', 'uncertain']) {
      const store = new MemoryStore(), d = deps(store);
      await executeRadar(below, { ...d, publish: false });
      const id = [...store.records.keys()][0];
      store.deliveries.set(id, state);
      expect(await executeRadar(above, d)).toMatchObject({ posted: 0 });
      expect([...store.deliveries]).toEqual([[id, state]]);
      expect(d.fetcher).not.toHaveBeenCalled();
    }
  });

  it('7: dryRun never writes a delivery for a newly qualifying existing assignment', async () => {
    const store = new MemoryStore(), d = deps(store);
    await executeRadar(below, { ...d, publish: false });
    const before = structuredClone([...store.records.values()]);
    expect(await executeRadar(above, { ...d, dryRun: true })).toMatchObject({ filtered: 0, posted: 0 });
    expect(store.deliveries.size).toBe(0);
    expect([...store.records.values()]).toEqual(before);
    expect(d.fetcher).not.toHaveBeenCalled();
  });

  it('8: qualification uses the current run threshold, so a threshold change can make it deliverable', async () => {
    const store = new MemoryStore(), d = deps(store);
    await executeRadar(below, { ...d, publish: false });
    expect(store.deliveries.size).toBe(0);
    await executeRadar(base, { ...d, publish: false, threshold: 70 });                          // falls back to deps threshold
    expect([...store.deliveries.values()]).toEqual(['pending']);
  });

  it('F: an assignment that stays below the threshold never gets a delivery', async () => {
    const store = new MemoryStore(), d = deps(store);
    for (let i = 0; i < 3; i++) await executeRadar(below, d);
    expect(store.deliveries.size).toBe(0);
    expect(d.fetcher).not.toHaveBeenCalled();
  });
});
