import type { CharacterMemory, CharacterProfile } from './schemas.js';
import type { ContentSelection } from './memory.js';

const json = (v: unknown): string => JSON.stringify(v, null, 2);

function memoryLine(m: CharacterMemory): string {
  const when = m.memoryType === 'episode'
    ? `occurred ${m.occurredAt}`
    : `${m.validFrom ?? '?'} → ${m.validTo ?? 'current'}${m.status === 'superseded' ? ' (no longer true)' : ''}`;
  const stance = m.value.stance ? ` [stance: ${m.value.stance}]` : '';
  const date = m.value.date ? ` [date: ${m.value.date}${m.value.recursYearly ? ', yearly' : ''}]` : '';
  return `- id=${m.id} | ${m.memoryType} | ${m.memoryKey} | ${m.audienceVisibility.toUpperCase()} | ${when}\n  ${m.value.summary}${stance}${date}`;
}

const VOICE_RULES = `Captions:
- Exactly 3 options. Each at most two short sentences, in the character's own voice as defined in canon.
- Never try hard to be funny. Understatement over punchlines. No hashtags, no emojis unless canon says so.`;

export function buildContentSystemPrompt(): string {
  return `You write content proposals for a persistent, openly fictional character with a continuous life.
You are given the character's STABLE CANON (identity, personality, voice, world), VISUAL CANON, PUBLIC PROFILE,
and a bounded set of MEMORIES valid on the scene date. Your job: keep the character recognisable and continuous.

Rules:
1. Canon is fixed. Never contradict it (age, appearance, personality, home, voice).
2. Memories marked PRIVATE are things the character knows but the audience has not been told. They may shape behaviour
   and mood, but captions must not reveal them unless the scene is explicitly about that subject. If a caption does reveal
   a private memory, list its id in revealsMemoryIds.
3. Memories marked "no longer true" are history: the character remembers them, but current state wins.
4. UNKNOWN STAYS UNKNOWN. Anything not in canon or memories is undecided: do not invent family members, names, birthdays,
   past jobs, childhood stories, romantic history or favourite foods. Keep captions vague rather than inventing them.
5. If the scene implies a new experience, preference or fact, propose it in memoryCandidates. These are proposals only;
   they become history only if an operator approves them. Use dotted snake_case keys (e.g. food.kimchi,
   coffee.grinder.purchase) and reuse existing keys when the topic matches. Episodes need occurredAt (the scene date).
   For preferences/opinions set value.stance to a short snake_case position (e.g. dislike, likes_some).
6. imagePrompt: one detailed photographic prompt preserving the visual canon exactly (face, age, hair, beard, skin
   texture, expression, clothing language) and the recurring home/kitchen/view described in canon, plus the scene,
   light and mood. Realistic, unretouched, never glossy.
7. continuityChecklist: concrete checks for THIS scene (identity, appearance, clothing, recurring location, view,
   consistency with current preferences, no contradiction of public biography, no accidental private reveal).
8. usedMemoryIds: ids of the memories you actually relied on. Only use ids from the list.

${VOICE_RULES}

Respond with JSON only:
{"imagePrompt": string, "captionOptions": string[], "continuityChecklist": string[],
 "memoryCandidates": [{"memoryType": "preference"|"opinion"|"fact"|"episode", "memoryKey": string,
   "value": {"summary": string, "stance"?: string}, "occurredAt"?: "YYYY-MM-DD", "tags"?: string[]}],
 "usedMemoryIds": string[], "revealsMemoryIds": string[]}`;
}

export function buildContentUserPrompt(profile: CharacterProfile, selection: ContentSelection, scene: string, date: string): string {
  const anniversaries = selection.anniversaries.length
    ? selection.anniversaries.map(a => `- id=${a.memory.id}: ${a.memory.value.summary} — anniversary today (${a.years} years)`).join('\n')
    : '(none)';
  return `CHARACTER: ${profile.displayName}
SCENE DATE: ${date}
SCENE: ${scene}

STABLE CANON:
${json(profile.privateCanon)}

VISUAL CANON:
${json(profile.visualCanon)}

PUBLIC PROFILE (what the audience has been told):
${json(profile.publicProfile)}

MEMORIES (bounded selection, valid on the scene date):
${selection.memories.map(memoryLine).join('\n') || '(none)'}

ANNIVERSARIES ON THIS DATE:
${anniversaries}`;
}

export function buildClassifySystemPrompt(): string {
  return `You turn an operator's statement about a fictional character into structured memories. Do not add details that
the statement does not contain.

Memory types:
- preference: tastes and likes/dislikes (set value.stance, e.g. dislike, likes_some, loves). Key like food.olives.
- opinion: views and beliefs (set value.stance). Key like opinion.smart_speakers.
- fact: facts about the character's life or people in it. Dates go in value.date (YYYY-MM-DD); birthdays set
  value.recursYearly=true. Key like family.father.birth_date.
- Memories about another person always live under that person's namespace, whatever the topic:
  family.<relation>.* (family.mother.favorite_food), friends.<name>.*, people.<name>.*. Never file another person's
  tastes or facts under the character's own topical keys (food.*, opinion.*, ...).
- episode: something that happened on a day. Set occurredAt (resolve "today", "yesterday", "last Saturday" relative
  to STATEMENT DATE). Key like food.kimchi.first_try.

Rules:
- value.summary is one third-person sentence using the character's name.
- Reuse an EXISTING KEY when the statement is about the same topic (a changed preference must use the same key).
- One statement may yield several memories (e.g. "likes dark chocolate but dislikes milk chocolate" = two preferences;
  "tried kimchi today and liked it" = an episode plus a preference).
- LOCKED CANON namespaces cannot be changed here. If the statement changes or contradicts stable canon (identity, age,
  appearance, personality, home...), set touchesLockedCanon=true, list the keys in lockedKeys and return no memories.
- Keys are dotted snake_case. Tags are short lowercase words.

Respond with JSON only:
{"memories": [{"memoryType": string, "memoryKey": string, "value": {"summary": string, "stance"?: string,
  "date"?: string, "recursYearly"?: boolean}, "occurredAt"?: string, "validFrom"?: string, "tags"?: string[]}],
 "touchesLockedCanon": boolean, "lockedKeys"?: string[]}`;
}

export function buildClassifyUserPrompt(name: string, text: string, date: string, locked: string[], catalog: string): string {
  return `CHARACTER: ${name}
STATEMENT DATE: ${date}
LOCKED CANON NAMESPACES: ${locked.join(', ') || '(none)'}
EXISTING KEYS:
${catalog}

STATEMENT:
${text}`;
}

export function buildRecallSystemPrompt(): string {
  return `You translate a question about a fictional character's memory into a retrieval plan. You never answer the
question yourself.

- subject (required): whose memories can answer. "self" when the question is about the character's own tastes, views,
  life or experiences. A person namespace when it is about someone else: "family.mother", "family.father",
  "family.sister", "friends.<name>", "people.<name>" (dotted snake_case). "family" for the family as a whole.
  null when you cannot tell who is meant, including a bare pronoun with no named referent ("What did they like?").
  "his"/"her" in a possessive relation ("his mother") refers to the character. Never answer a question about another
  person with the character's own
  memories, and never the reverse: "<character>'s mother's favorite food" is subject "family.mother", not "self".
- memoryKeys: exact existing keys that match. keyPrefixes: key namespaces (e.g. family.father) that match. Only
  choose keys and prefixes that belong to the subject.
- tags: existing tags that match. terms: 1-5 plain keywords as fallback text search (e.g. olives, father).
- memoryTypes: restrict only when the question clearly asks for events ("what did they do" = episode).
- from/to: an inclusive date range when the question refers to time ("last Christmas" relative to TODAY means the most
  recent 24-26 December on or before TODAY).
- scope: "audience" if the question asks what the audience/public/followers know or have been told; "internal" if it
  asks what we/the character internally know; omit otherwise.

Respond with JSON only:
{"scope"?: "internal"|"audience", "subject": string|null, "memoryKeys": string[], "keyPrefixes": string[], "tags": string[],
 "terms": string[], "memoryTypes": string[], "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD"}`;
}

export function buildRecallUserPrompt(name: string, query: string, today: string, catalog: string): string {
  return `CHARACTER: ${name}
TODAY: ${today}
EXISTING KEYS:
${catalog}

QUESTION:
${query}`;
}
