import type { CharacterMemory, CharacterProfile, MemoryInput, MemoryValue, RecallPlan } from './schemas.js';

// Pure, deterministic memory logic. No I/O and no model calls, so temporal behaviour is easy to test.

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'what', 'does', 'did', 'about', 'think', 'his', 'her',
  'their', 'has', 'have', 'was', 'who', 'how', 'when', 'this', 'that', 'from', 'into', 'than', 'they', 'know']);

/** Naive plural folding: berries→berry, tomatoes→tomato, olives→olive. */
function stem(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    tokens.add(stem(raw));
  }
  return tokens;
}

function memoryTokens(m: CharacterMemory): Set<string> {
  return tokenize(`${m.memoryKey.replace(/[._]/g, ' ')} ${m.tags.join(' ')} ${m.value.summary}`);
}

/** Query terms minus the character's own name, which appears in nearly every summary. */
function queryTerms(text: string, name: string): Set<string> {
  const terms = tokenize(text);
  for (const t of tokenize(name)) terms.delete(t);
  return terms;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** The in-world date a memory became known: occurred_at for episodes, valid_from otherwise. */
export function knownFrom(m: CharacterMemory): string {
  return (m.memoryType === 'episode' ? m.occurredAt : m.validFrom) ?? '0000-01-01';
}

/** Whether a non-episode memory was the character's current state on `date`. */
export function isValidAt(m: CharacterMemory, date: string): boolean {
  if (m.memoryType === 'episode') return false;
  return (m.validFrom ?? '0000-01-01') <= date && (m.validTo === null || m.validTo > date);
}

/** Current state: as of a date when given, otherwise the active rows. */
export function isCurrent(m: CharacterMemory, asOf: string | null): boolean {
  if (m.memoryType === 'episode') return false;
  return asOf ? isValidAt(m, asOf) : m.status === 'active';
}

/**
 * Locked namespaces: the top-level sections of the stable canon plus keys of memories marked locked.
 * A memory key inside one of these may only be changed through the privileged bootstrap path.
 */
export function lockedNamespaces(profile: CharacterProfile, memories: CharacterMemory[]): string[] {
  const keys = new Set([...Object.keys(profile.privateCanon), ...Object.keys(profile.visualCanon)]);
  for (const m of memories) if (m.locked && m.status === 'active') keys.add(m.memoryKey);
  return [...keys].map(k => k.toLowerCase()).sort();
}

export function isLockedKey(key: string, namespaces: string[]): boolean {
  return namespaces.some(ns => key === ns || key.startsWith(`${ns}.`));
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Same position? Stance/date decide when present, so rephrased summaries don't create spurious history. */
export function sameValue(a: MemoryValue, b: MemoryValue): boolean {
  if (a.stance !== undefined || b.stance !== undefined || a.date !== undefined || b.date !== undefined) {
    return a.stance === b.stance && a.date === b.date;
  }
  return stableStringify(a) === stableStringify(b);
}

export type WritePlan =
  | { op: 'insert'; validFrom: string | null; occurredAt: string | null }
  | { op: 'supersede'; previous: CharacterMemory; validFrom: string }
  | { op: 'unchanged'; existing: CharacterMemory }
  | { op: 'reject'; reason: string };

/** Decide how a submitted memory changes history. Never deletes: changes supersede the current row. */
export function planWrite(
  existing: CharacterMemory[],
  input: MemoryInput,
  opts: { date: string; locked: string[]; allowLocked: boolean },
): WritePlan {
  if (!opts.allowLocked && isLockedKey(input.memoryKey, opts.locked)) {
    return { op: 'reject', reason: `'${input.memoryKey}' is locked canon and cannot be changed through remember` };
  }
  if (input.memoryType === 'episode') {
    const occurredAt = input.occurredAt ?? opts.date;
    const same = existing.find(m => m.memoryType === 'episode' && m.memoryKey === input.memoryKey && m.occurredAt === occurredAt);
    return same ? { op: 'unchanged', existing: same } : { op: 'insert', validFrom: null, occurredAt };
  }
  const validFrom = input.validFrom ?? opts.date;
  const recorded = existing.find(m => m.memoryType !== 'episode' && m.memoryKey === input.memoryKey
    && m.validFrom === validFrom && sameValue(m.value, input.value));
  if (recorded) return { op: 'unchanged', existing: recorded };
  const current = existing.find(m => m.memoryType !== 'episode' && m.memoryKey === input.memoryKey && m.status === 'active');
  if (!current) return { op: 'insert', validFrom, occurredAt: null };
  if (current.locked && !opts.allowLocked) {
    return { op: 'reject', reason: `'${input.memoryKey}' is locked canon and cannot be changed through remember` };
  }
  if (sameValue(current.value, input.value)) return { op: 'unchanged', existing: current };
  if (current.validFrom && validFrom < current.validFrom) {
    return { op: 'reject', reason: `'${input.memoryKey}' already has a newer value (from ${current.validFrom}); history must move forward` };
  }
  return { op: 'supersede', previous: current, validFrom };
}

/** Days are compared as MM-DD; a 29 Feb anniversary falls on 28 Feb in non-leap years. */
function anniversaryIn(year: number, date: string): string {
  const md = date.slice(5);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return `${year}-${md === '02-29' && !leap ? '02-28' : md}`;
}

export function nextAnniversary(date: string, from: string): { on: string; years: number } {
  let year = Number(from.slice(0, 4));
  if (anniversaryIn(year, date) < from) year++;
  return { on: anniversaryIn(year, date), years: year - Number(date.slice(0, 4)) };
}

export interface ContentSelection {
  memories: CharacterMemory[];
  anniversaries: Array<{ memory: CharacterMemory; years: number }>;
}

/**
 * Bounded selection for content generation: relevant current state on the scene date, the history of
 * those keys (so a changed mind is visible), relevant + recent episodes, and anniversaries falling that day.
 * Unrelated private facts are deliberately left out.
 */
export function selectForContent(
  memories: CharacterMemory[],
  scene: string,
  date: string,
  characterName = '',
  limits = { current: 12, history: 6, episodes: 6 },
): ContentSelection {
  const terms = queryTerms(scene, characterName);
  const known = memories.filter(m => knownFrom(m) <= date);
  const byRelevance = (list: CharacterMemory[]): Array<{ m: CharacterMemory; score: number }> =>
    list.map(m => ({ m, score: overlap(terms, memoryTokens(m)) }))
      .sort((a, b) => b.score - a.score || knownFrom(b.m).localeCompare(knownFrom(a.m)));

  const current = byRelevance(known.filter(m => isValidAt(m, date)));
  const relevant = current.filter(r => r.score > 0).map(r => r.m);
  // Texture: recent tastes and opinions, never unrelated facts.
  const texture = current.filter(r => r.score === 0 && r.m.memoryType !== 'fact').map(r => r.m);
  const chosenCurrent = [...relevant, ...texture].slice(0, limits.current);
  const chosenKeys = new Set(chosenCurrent.map(m => m.memoryKey));

  const history = known
    .filter(m => m.memoryType !== 'episode' && !isValidAt(m, date) && chosenKeys.has(m.memoryKey))
    .sort((a, b) => knownFrom(b).localeCompare(knownFrom(a)))
    .slice(0, limits.history);

  const episodes = byRelevance(known.filter(m => m.memoryType === 'episode'));
  const relevantEpisodes = episodes.filter(r => r.score > 0).slice(0, 3).map(r => r.m);
  const recentEpisodes = episodes.map(r => r.m).sort((a, b) => knownFrom(b).localeCompare(knownFrom(a)));
  const chosenEpisodes = [...new Set([...relevantEpisodes, ...recentEpisodes])].slice(0, limits.episodes);

  const anniversaries = known
    .filter(m => isValidAt(m, date) && m.value.recursYearly && m.value.date && anniversaryIn(Number(date.slice(0, 4)), m.value.date) === date)
    .map(m => ({ memory: m, years: nextAnniversary(m.value.date as string, date).years }));

  const selected = [...new Set([...chosenCurrent, ...history, ...chosenEpisodes, ...anniversaries.map(a => a.memory)])];
  return { memories: selected, anniversaries };
}

function matchesPlan(m: CharacterMemory, plan: RecallPlan, name: string): boolean {
  if (plan.memoryTypes.length && !plan.memoryTypes.includes(m.memoryType)) return false;
  if (plan.from || plan.to) {
    const d = knownFrom(m);
    if ((plan.from && d < plan.from) || (plan.to && d > plan.to)) return false;
  }
  const hasSelectors = plan.memoryKeys.length || plan.keyPrefixes.length || plan.tags.length || plan.terms.length;
  if (!hasSelectors) return Boolean(plan.from || plan.to || plan.memoryTypes.length);
  if (plan.memoryKeys.includes(m.memoryKey)) return true;
  if (plan.keyPrefixes.some(p => m.memoryKey === p || m.memoryKey.startsWith(`${p}.`))) return true;
  if (plan.tags.some(t => m.tags.includes(t))) return true;
  return plan.terms.length > 0 && overlap(queryTerms(plan.terms.join(' '), name), memoryTokens(m)) > 0;
}

function describe(m: CharacterMemory, today: string): string {
  if (m.value.recursYearly && m.value.date) {
    const next = nextAnniversary(m.value.date, today);
    return `${m.value.summary} (recurs yearly; next ${next.on}, ${next.years} years)`;
  }
  return m.value.summary;
}

export interface RecallResult {
  answer: string;
  current: string[];
  history: string[];
  episodes: string[];
  memoryIds: string[];
  unrevealedMemoryIds?: string[];
}

/**
 * Deterministic recall: the answer is assembled from stored rows only, so it cannot invent facts.
 * Audience scope sees only revealed (public) memories and reports which matching memories remain private.
 */
export function recallMemories(
  memories: CharacterMemory[],
  plan: RecallPlan,
  scope: 'internal' | 'audience',
  asOf: string | null,
  today: string,
  characterName = '',
): RecallResult {
  const inTime = asOf ? memories.filter(m => knownFrom(m) <= asOf) : memories;
  const matched = inTime.filter(m => matchesPlan(m, plan, characterName));
  const visible = scope === 'audience' ? matched.filter(m => m.audienceVisibility === 'public') : matched;
  const unrevealed = scope === 'audience' ? matched.filter(m => m.audienceVisibility === 'private').map(m => m.id) : undefined;
  const ref = asOf ?? today;

  const current = visible.filter(m => isCurrent(m, asOf)).sort((a, b) => a.memoryKey.localeCompare(b.memoryKey));
  const episodes = visible.filter(m => m.memoryType === 'episode').sort((a, b) => knownFrom(a).localeCompare(knownFrom(b)));

  const byKey = new Map<string, CharacterMemory[]>();
  for (const m of visible) {
    if (m.memoryType === 'episode') continue;
    byKey.set(m.memoryKey, [...(byKey.get(m.memoryKey) ?? []), m]);
  }
  const span = (m: CharacterMemory): string =>
    `${m.validFrom ?? '?'} → ${(asOf && m.validTo && m.validTo > asOf ? null : m.validTo) ?? 'now'}`;
  const history: string[] = [];
  for (const rows of byKey.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => knownFrom(a).localeCompare(knownFrom(b)));
    for (const m of rows) history.push(`${span(m)}: ${m.value.summary}`);
  }
  const past = visible
    .filter(m => m.memoryType !== 'episode' && !isCurrent(m, asOf))
    .sort((a, b) => knownFrom(a).localeCompare(knownFrom(b)));
  const previously = past.map(m => `${m.value.summary.replace(/\.$/, '')} (${span(m)})`);

  const currentLines = current.map(m => describe(m, ref));
  const episodeLines = episodes.map(m => `${m.occurredAt}: ${m.value.summary}`);
  const ids = [...new Set([...current, ...past, ...episodes].map(m => m.id))];

  let answer: string;
  if (!visible.length) {
    if (scope === 'audience') {
      answer = unrevealed?.length
        ? `Not publicly revealed. ${unrevealed.length} matching private memor${unrevealed.length === 1 ? 'y exists' : 'ies exist'} internally.`
        : 'Nothing about this is known, publicly or privately.';
    } else {
      answer = 'Unknown: nothing has been stored about this. Treat it as undecided rather than inventing it.';
    }
  } else {
    const parts: string[] = [];
    if (scope === 'audience') parts.push('Publicly revealed:');
    if (currentLines.length) parts.push(`Currently: ${currentLines.join(' ')}`);
    if (previously.length) parts.push(`Previously: ${previously.join('; ')}.`);
    if (episodeLines.length) parts.push(`Episodes: ${episodeLines.join(' ')}`);
    answer = parts.join(' ');
  }

  return { answer, current: currentLines, history, episodes: episodeLines, memoryIds: ids,
    ...(unrevealed ? { unrevealedMemoryIds: unrevealed } : {}) };
}

/** Compact key catalog for model planning/classification — keys, types and tags, never values. */
export function keyCatalog(memories: CharacterMemory[], limit = 300): string {
  const seen = new Map<string, string>();
  for (const m of memories) {
    if (seen.size >= limit) break;
    const id = `${m.memoryType}:${m.memoryKey}`;
    if (!seen.has(id)) seen.set(id, `${m.memoryKey} (${m.memoryType}${m.tags.length ? `; tags ${m.tags.join(',')}` : ''})`);
  }
  return [...seen.values()].join('\n') || '(none yet)';
}
