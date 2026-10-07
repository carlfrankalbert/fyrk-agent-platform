import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { emagineAdapter, parseEmagine } from '../src/agents/assignment-radar/sources/emagine.js';
import { rightPeopleGroupAdapter, parseRightPeopleGroup } from '../src/agents/assignment-radar/sources/rightpeoplegroup.js';
import { spertonAdapter, parseSperton } from '../src/agents/assignment-radar/sources/sperton.js';
import { sevenNAdapter, parseSevenN } from '../src/agents/assignment-radar/sources/sevenn.js';
import { dateValue } from '../src/agents/assignment-radar/normalize.js';
import { requirements, scoreAssignment } from '../src/agents/assignment-radar/score.js';
import { ProfileSchema } from '../src/agents/assignment-radar/schemas.js';
import { duplicateReason, mergeObservation } from '../src/agents/assignment-radar/dedup.js';
import type { SourceAdapter } from '../src/agents/assignment-radar/sources/common.js';

// Captured public responses, 2026-10-01; derived mutations exercise pagination and changed formats.
const now = '2026-10-01T01:00:00.000Z';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/assignment-radar/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));
const response = (value: unknown) => new Response(JSON.stringify(value));
const spertonUrl = 'https://career.sperton.com/jobs/8474750-seniorradgiver-hr-tech-og-digitalisering';
const sevenNUrl = 'https://jobs.7n.com/umbraco/api/content/getjoboffercontent?id=4330';
const profile = ProfileSchema.parse({});

describe('emagine public Norway API', () => {
  it('normalizes real detail metadata without inferring extent from isPartTime', () => {
    expect(parseEmagine(fixture('emagine.json'), now)).toMatchObject({ source: 'emagine', external_id: '180627',
      title: 'Prosjektleder nye digitale virksomhetskritiske tjenester – NPE', customer: null,
      location: 'Oslo / Norway / Onsite', start_date: '2027-01-04', extent: 'inntil 100%', deadline: '6.10', first_seen_at: now });
    const detail = { ...json('emagine.json'), description: '<p>Omfang: 40%</p>', isPartTime: false };
    expect(parseEmagine(JSON.stringify(detail), now)?.extent).toBe('40%');
    expect(parseEmagine(JSON.stringify({ ...detail, description: '<p>Rollebeskrivelse</p>' }), now)?.extent).toBeNull();
  });
  it('fetches every page with an unauthenticated Norway filter and isolates a failed detail', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/Search')) {
        const request = JSON.parse(init?.body as string);
        expect(request.filter.workLocations).toEqual([{ countryId: 'NO', city: '', region: '' }]);
        expect(request.supportedLanguageId).toBe('NO');
        return response({ totalCount: 2, items: [{ id: request.skipCount ? 2 : 180627, title: 'Project manager' }] });
      }
      return url.includes('/details/2/') ? new Response('', { status: 503 }) : new Response(fixture('emagine.json'));
    });
    const result = await emagineAdapter.fetch(f, now);
    expect(result.assignments).toHaveLength(1); expect(result.errors).toHaveLength(1);
    expect(f.mock.calls.filter(([url]) => url.endsWith('/Search')).map(([, init]) => JSON.parse(init!.body as string).skipCount)).toEqual([0, 100]);
    for (const [, init] of f.mock.calls) expect(init?.headers).not.toHaveProperty('Authorization');
  });
  it('accepts empty results and detects repeated/incomplete pagination', async () => {
    expect(await emagineAdapter.fetch(async () => response({ items: [], totalCount: 0 }), now)).toEqual({ assignments: [], errors: [] });
    await expect(emagineAdapter.fetch(async () => response({ items: [], totalCount: 1 }), now)).rejects.toThrow('Empty page');
    await expect(emagineAdapter.fetch(async () => response({ items: [{ id: 1, title: 'Role' }], totalCount: 2 }), now)).rejects.toThrow('Repeated');
  });
  it('does not expose closed or filled advertisements', () => {
    expect(parseEmagine(JSON.stringify({ ...json('emagine.json'), status: 'Closed' }), now)).toBeNull();
    expect(parseEmagine(JSON.stringify({ ...json('emagine.json'), title: 'Dekket Stilling - Prosjektleder' }), now)).toBeNull();
  });
});

describe('Right People Group complete SSR listing', () => {
  it('uses embedded full descriptions and retains only open Norwegian assignments', async () => {
    const f = vi.fn(async () => new Response(fixture('rightpeoplegroup.html')));
    const { assignments } = await rightPeopleGroupAdapter.fetch(f, now);
    expect(f).toHaveBeenCalledTimes(1); expect(assignments).toHaveLength(5);
    expect(assignments[0]).toMatchObject({ source: 'rightpeoplegroup', external_id: '3556', location: 'Oslo area (hybrid)',
      extent: '100%', start_date: 'ASAP / By Agreement', customer: null, deadline: null });
    expect(assignments[0].description).toContain('Required Qualifications');
    const risk = assignments.find(a => a.external_id === '3539')!;
    expect(risk.deadline).toBe('2026-09-09'); expect(scoreAssignment(risk, profile, '2026-10-01').total).toBe(0);
  });
  it('recognizes genuinely empty/closed listings and rejects a missing SSR envelope', () => {
    expect(parseRightPeopleGroup('<script id="__NEXT_DATA__">{"props":{"pageProps":{"projects":[]}}}</script>', now)).toEqual([]);
    const $ = load(fixture('rightpeoplegroup.html')), data = JSON.parse($('#__NEXT_DATA__').text());
    data.props.pageProps.projects.forEach((job: { open: boolean }) => { job.open = false; });
    expect(parseRightPeopleGroup(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`, now)).toEqual([]);
    expect(() => parseRightPeopleGroup('<h1>Sign in</h1>', now)).toThrow();
  });
});

describe('Sperton consultant department HTML and JobPosting', () => {
  it('decodes descriptions, keeps end-customer unknown and prefers the explicit assignment deadline', () => {
    const a = parseSperton(fixture('sperton.html'), spertonUrl, now)!;
    expect(a).toMatchObject({ source: 'sperton', external_id: '8474750', customer: null, start_date: '2026-10-01',
      extent: 'Inntil 100 %', deadline: '2026-10-04', location: 'Oslo, Norge / On-site / hjemmekontor etter avtale' });
    expect(a.description).not.toMatch(/&lt;|<p>|Om Sperton/);
    expect(requirements(a.description).required).toContain('Dokumentert erfaring med HR Tech og digitalisering av HR-funksjoner.');
    expect(scoreAssignment(a, profile, '2026-10-01').total).toBeLessThan(70);
  });
  it('includes real full-time consulting projects and normalizes English dates', () => {
    const a = parseSperton(fixture('sperton-project.html'), 'https://career.sperton.com/jobs/8373558-senior-it-project-manager', now)!;
    expect(a).toMatchObject({ title: 'Senior IT Project Manager', start_date: '2026-09-21', deadline: '2026-10-01' });
    expect(a.location).toContain('Oslo'); expect(a.location).toContain('Hybrid');
    expect(scoreAssignment(a, profile, '2026-10-02').relevant).toBe(false);
    expect(() => parseSperton(fixture('sperton.html'), 'https://career.sperton.com/jobs/999-wrong', now)).toThrow('identity');
  });
  it('follows show_more, preserves country/department and excludes standing network registrations', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('show_more')) {
        expect(new URL(url).searchParams.get('department')).toBe('Consultant jobs');
        expect(new URL(url).searchParams.get('country')).toBe('Norway');
        return new Response('<turbo-stream><template><a href="/jobs/8474750-seniorradgiver-hr-tech-og-digitalisering">Seniorrådgiver</a></template></turbo-stream>');
      }
      if (url.includes('/jobs?')) return new Response('<div id="jobs"><a href="/jobs/6588851-network">Frilansere/Konsulenter – Norge</a><a href="/jobs/show_more?page=2">Show more</a></div>');
      return new Response(fixture('sperton.html'));
    });
    const result = await spertonAdapter.fetch(f, now);
    expect(result.assignments).toHaveLength(1); expect(result.errors).toEqual([]);
    expect(f.mock.calls.some(([url]) => url.includes('6588851'))).toBe(false);
  });
  it('handles empty lists and isolates a failed detail', async () => {
    expect((await spertonAdapter.fetch(async () => new Response('<div id="jobs_list_container"></div>'), now)).assignments).toEqual([]);
    const f = async (url: string) => url.includes('/jobs?') ? new Response(fixture('sperton-list.html')) :
      url.includes('8474750-') ? new Response(fixture('sperton.html')) : new Response('', { status: 503 });
    const result = await spertonAdapter.fetch(f, now);
    expect(result.assignments).toHaveLength(1); expect(result.errors.length).toBeGreaterThan(0);
  });
  it('detects pagination loops and access/format changes', async () => {
    await expect(spertonAdapter.fetch(async () => new Response('<div id="jobs"><a href="/jobs/8474750-test">Role</a><a href="/jobs/show_more?page=2">More</a></div>'), now)).rejects.toThrow('Repeated');
    await expect(spertonAdapter.fetch(async () => new Response('<h1>Login</h1>'), now)).rejects.toThrow('Unrecognized');
  });
});

describe('7N public API', () => {
  const project = () => ({ ...json('sevenn.json'), Title: 'Senior Test Manager', ShortDescription: '<p>Specific banking migration project</p>',
    MainDescription: '<p>Location: Oslo</p><p>Start Date: 1 November 2026</p><p>Allocation: 80%</p><p>Application Deadline: 15 October 2026</p><p>Client: Bank AS</p><p>Testledelse og smidig leveranse</p><h4>What you can expect from 7N</h4><p>Generic marketing</p>' });
  it('excludes the real standing network ad and normalizes a concrete project in the same model', () => {
    expect(parseSevenN(fixture('sevenn.json'), sevenNUrl, now)).toBeNull();
    const a = parseSevenN(JSON.stringify(project()), sevenNUrl, now)!;
    expect(a).toMatchObject({ source: '7n', external_id: '4330', url: 'https://jobs.7n.com/job-offers/4330',
      title: 'Senior Test Manager', customer: 'Bank AS', start_date: '2026-11-01', extent: '80%', deadline: '2026-10-15' });
    expect(a.description).not.toContain('Generic marketing');
    expect(parseSevenN(JSON.stringify({ ...project(), Country: 'Denmark' }), sevenNUrl, now)).toBeNull();
  });
  it('discovers the Norway ID, paginates and tolerates a failed detail', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('LocalizationsAndCategories')) return response(json('sevenn-filters.json'));
      if (url.endsWith('/ShowJobOffers')) {
        const request = JSON.parse(init?.body as string); expect(request.Countries).toEqual([254]);
        return response(request.Offset ? [] : Array.from({ length: 50 }, (_, i) => ({ id: String(4330 + i), name: 'Role', country: 'Norway' })));
      }
      return url.endsWith('=4330') ? response(project()) : new Response('', { status: 503 });
    });
    const result = await sevenNAdapter.fetch(f, now);
    expect(result.assignments).toHaveLength(1); expect(result.errors).toHaveLength(49);
    expect(f.mock.calls.filter(([url]) => url.endsWith('/ShowJobOffers')).map(([, init]) => JSON.parse(init!.body as string).Offset)).toEqual([0, 50]);
  });
  it('accepts zero concrete assignments or no Norway filter, and rejects changed envelopes', async () => {
    const f = async (url: string) => url.includes('LocalizationsAndCategories') ? response(json('sevenn-filters.json')) :
      url.endsWith('/ShowJobOffers') ? response(json('sevenn-list.json')) : new Response(fixture('sevenn.json'));
    expect(await sevenNAdapter.fetch(f, now)).toEqual({ assignments: [], errors: [] });
    expect(await sevenNAdapter.fetch(async () => response({ localizationFilters: [] }), now)).toEqual({ assignments: [], errors: [] });
    expect(() => parseSevenN('{}', sevenNUrl, now)).toThrow();
  });
});

describe('shared behavior across the added sources', () => {
  it.each([emagineAdapter, rightPeopleGroupAdapter, spertonAdapter, sevenNAdapter])('$source reports HTTP failures instead of claiming zero assignments', async (adapter: SourceAdapter) => {
    await expect(adapter.fetch(async () => new Response('', { status: 403 }), now)).rejects.toThrow('403');
    await expect(adapter.fetch(async () => new Response('<h1>Login</h1>'), now)).rejects.toThrow();
  });
  it.each(['emagine', 'rightpeoplegroup', 'sperton', '7n'] as const)('attaches %s to an existing assignment, preserves first_seen and resolves already-seen identity', source => {
    const a = parseSperton(fixture('sperton-project.html'), 'https://career.sperton.com/jobs/8373558-senior-it-project-manager', now)!;
    const first = { ...a, source: 'ic' as const, url: 'https://ic.no/oppdrag/finance-receivables', external_id: 'existing', first_seen_at: '2026-09-30T01:00:00.000Z' };
    const incoming = { ...a, source, external_id: 'other', url: `https://example.com/${source}/other` };
    expect(duplicateReason(first, incoming)).toBe('text');
    const record = mergeObservation({ id: 'canonical', assignment: first, observations: [first], score: scoreAssignment(first, profile) }, incoming);
    expect(record.id).toBe('canonical'); expect(record.observations).toHaveLength(2); expect(record.assignment.first_seen_at).toBe(first.first_seen_at);
    expect(duplicateReason(record.observations[1], { ...incoming, title: 'Updated title' })).toBe('external_id');
  });
  it('reads new requirement headings without scoring the heading itself as an unsupported requirement', () => {
    expect(requirements('Må ha krav:\nCSPO\nBør ha krav:\nPMP')).toEqual({ required: ['CSPO'], desired: ['PMP'] });
    expect(requirements('Krav\nMå ha\nMastergrad\nFordelaktig å ha\nSAP')).toEqual({ required: ['Mastergrad'], desired: ['SAP'] });
  });
  it.each([['21 September 2026', '2026-09-21'], ['1 October 2026', '2026-10-01'], ['2026-10-06 23:59:59 +0200', '2026-10-06'], ['6.10', '6.10']])('normalizes %s without inventing a missing year', (value, expected) => {
    expect(dateValue(value)).toBe(expected);
  });
});
