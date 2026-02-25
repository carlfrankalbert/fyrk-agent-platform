import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callClaude, extractText } from '../../lib/claude.js';
import type { ClaudeMessage } from '../../lib/claude.js';
import { stripJsonFences } from '../../lib/json.js';
import { DAY_NAMES } from '../../lib/constants.js';
import type { Logger } from '../../lib/types.js';

// --- Types ---

export interface Learning {
  id: string;
  category: string;
  insight: string;
  confidence: number;
  confirmed: boolean | null;
  source: string;
}

export interface MealPattern {
  type: 'favorite' | 'avoid' | 'weekday' | 'balance';
  description: string;
}

// --- Extraction schema ---

const ExtractionResultSchema = z.array(z.object({
  category: z.enum(['preference', 'household_info', 'feedback', 'constraint', 'routine']),
  insight: z.string(),
  confidence: z.number().min(0).max(1),
  supersedes: z.string().optional(),
  expires_in_days: z.number().optional(),
}));

// --- Mechanism 1: Conversation extraction ---

const EXTRACTION_PROMPT = `Du er en analytiker som trekker ut varige lerdommer fra samtaler mellom en familie og deres matplanlegger "Husmor".

Analyser samtalen og trekk ut varige innsikter. Returner en JSON-array med objekter.

Kategorier:
- preference: Matpreferanser (liker/misliker, favoritter)
- household_info: Informasjon om husholdningen (antall personer, barns alder, etc.)
- feedback: Tilbakemelding pa spesifikke retter
- constraint: Begrensninger (allergier, diett, tid)
- routine: Faste rutiner (taco-fredag, etc.)

Regler:
- Bare varige lerdommer, ikke situasjonsbestemt (f.eks. "vi har laks i kjoleskapet" er IKKE varig)
- Kort og konkret insight (maks 100 tegn)
- confidence 0.0-1.0 (0.9+ for eksplisitte utsagn, 0.5-0.8 for implisitte)
- Sett expires_in_days for tidsbundne lerdommer
- Hvis en ny lring motisier en eksisterende, sett "supersedes" til insight-teksten til den gamle
- Returner tom array [] hvis ingen varige lerdommer finnes

EKSISTERENDE LERDOMMER (ikke gjenta disse):
{existingLearnings}

Returner KUN en JSON-array, ingen annen tekst.`;

export async function extractLearnings(
  supabase: SupabaseClient,
  apiKey: string,
  threadTs: string,
  messages: ClaudeMessage[],
  existingLearnings: Learning[],
  logger: Logger,
): Promise<void> {
  // Guard: minimum 1 user message
  const userMessageCount = messages.filter(m => m.role === 'user').length;
  if (userMessageCount < 1) return;

  // Guard: already extracted for this thread
  const { data: existing } = await supabase
    .from('household_learnings')
    .select('id')
    .eq('thread_ts', threadTs)
    .eq('source', 'extraction')
    .limit(1);

  if (existing && existing.length > 0) return;

  // Build extraction prompt
  const existingStr = existingLearnings.length > 0
    ? existingLearnings.map(l => `- [${l.category}] ${l.insight}`).join('\n')
    : '(ingen)';

  const systemPrompt = EXTRACTION_PROMPT.replace('{existingLearnings}', existingStr);

  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'Bruker' : 'Husmor'}: ${m.content}`)
    .join('\n');

  const response = await callClaude(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: conversationText }],
    cache_control: { type: 'ephemeral' },
  });

  logger.info({
    input_tokens: response.usage.input_tokens,
    cache_read: response.usage.cache_read_input_tokens ?? 0,
    cache_write: response.usage.cache_creation_input_tokens ?? 0,
    output_tokens: response.usage.output_tokens,
  }, 'Claude API usage (learning_extraction)');

  const text = extractText(response);
  const jsonStr = stripJsonFences(text);

  let learnings: z.infer<typeof ExtractionResultSchema>;
  try {
    learnings = ExtractionResultSchema.parse(JSON.parse(jsonStr));
  } catch {
    logger.warn({ text }, 'Failed to parse extraction response');
    return;
  }

  if (learnings.length === 0) return;

  // Handle supersession
  for (const learning of learnings) {
    if (learning.supersedes) {
      const { data: old } = await supabase
        .from('household_learnings')
        .select('id')
        .eq('insight', learning.supersedes)
        .is('superseded_by', null)
        .limit(1);

      if (old && old.length > 0) {
        // Insert new learning first, then update old
        const { data: newRow } = await supabase
          .from('household_learnings')
          .insert({
            household_id: 'default',
            thread_ts: threadTs,
            category: learning.category,
            insight: learning.insight,
            confidence: learning.confidence,
            source: 'extraction',
            expires_at: learning.expires_in_days
              ? new Date(Date.now() + learning.expires_in_days * 86400000).toISOString()
              : null,
          })
          .select('id')
          .single();

        if (newRow) {
          await supabase
            .from('household_learnings')
            .update({ superseded_by: newRow.id })
            .eq('id', old[0].id);
        }
        continue;
      }
    }

    // Normal insert
    await supabase
      .from('household_learnings')
      .insert({
        household_id: 'default',
        thread_ts: threadTs,
        category: learning.category,
        insight: learning.insight,
        confidence: learning.confidence,
        source: 'extraction',
        expires_at: learning.expires_in_days
          ? new Date(Date.now() + learning.expires_in_days * 86400000).toISOString()
          : null,
      });
  }

  logger.info({ threadTs, count: learnings.length }, 'Extracted learnings from conversation');
}

// --- Load active learnings ---

export async function loadLearnings(supabase: SupabaseClient): Promise<Learning[]> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('household_learnings')
    .select('id, category, insight, confidence, confirmed, source, expires_at')
    .eq('household_id', 'default')
    .is('superseded_by', null)
    .not('confirmed', 'eq', false)
    .gte('confidence', 0.5)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: false })
    .limit(30);

  return (data ?? []).map((l: Record<string, unknown>) => ({
    id: l.id as string,
    category: l.category as string,
    insight: l.insight as string,
    confidence: l.confidence as number,
    confirmed: l.confirmed as boolean | null,
    source: l.source as string,
  }));
}

// --- Build learnings section for prompt ---

const CATEGORY_LABELS: Record<string, string> = {
  preference: 'Matpreferanser',
  household_info: 'Husholdningsinformasjon',
  feedback: 'Tilbakemeldinger',
  constraint: 'Begrensninger',
  routine: 'Rutiner',
  pattern: 'Monstre',
};

export function buildLearningsSection(learnings: Learning[]): string | null {
  if (learnings.length === 0) return null;

  const grouped = new Map<string, Learning[]>();
  for (const l of learnings) {
    const existing = grouped.get(l.category) ?? [];
    existing.push(l);
    grouped.set(l.category, existing);
  }

  const lines: string[] = ['## Lerdommer fra tidligere samtaler', 'Bruk disse aktivt nar du planlegger og anbefaler.\n'];

  for (const [category, items] of grouped) {
    const label = CATEGORY_LABELS[category] ?? category;
    lines.push(`### ${label}`);
    for (const item of items) {
      const confirmed = item.confirmed === true ? ' (bekreftet)' : '';
      lines.push(`- ${item.insight}${confirmed}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Mechanism 2: Meal pattern analysis ---

interface MealRow {
  name: string;
  day_of_week: number;
  rating: number | null;
  feedback_emoji: string | null;
  feedback_text: string | null;
  week_number: number;
  year: number;
}

/** Recency weight based on age in weeks: 0-4w → 1.0, 4-8w → 0.7, 8-12w → 0.4, older → 0.2 */
export function recencyWeight(mealWeek: number, mealYear: number): number {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const currentWeek = Math.ceil((Math.floor((now.getTime() - jan1.getTime()) / 86400000) + jan1.getDay() + 1) / 7);
  const currentYear = now.getFullYear();
  const ageInWeeks = (currentYear - mealYear) * 52 + (currentWeek - mealWeek);
  if (ageInWeeks <= 4) return 1.0;
  if (ageInWeeks <= 8) return 0.7;
  if (ageInWeeks <= 12) return 0.4;
  return 0.2;
}

export async function computeMealPatterns(supabase: SupabaseClient): Promise<MealPattern[]> {
  // Fetch all planned meals with their plan info
  const { data: plans } = await supabase
    .from('weekly_plans')
    .select('id, week_number, year')
    .eq('household_id', 'default')
    .order('year', { ascending: false })
    .order('week_number', { ascending: false });

  if (!plans || plans.length === 0) return [];

  const planIds = plans.map((p: { id: string }) => p.id);
  const planLookup = new Map(plans.map((p: { id: string; week_number: number; year: number }) => [p.id, p]));

  const { data: meals } = await supabase
    .from('planned_meals')
    .select('plan_id, name, day_of_week, rating, feedback_emoji, feedback_text')
    .in('plan_id', planIds);

  if (!meals || meals.length === 0) return [];

  const enrichedMeals: MealRow[] = meals.map((m: Record<string, unknown>) => {
    const plan = planLookup.get(m.plan_id as string) as { week_number: number; year: number } | undefined;
    return {
      name: m.name as string,
      day_of_week: m.day_of_week as number,
      rating: m.rating as number | null,
      feedback_emoji: m.feedback_emoji as string | null,
      feedback_text: (m.feedback_text as string | null) ?? null,
      week_number: plan?.week_number ?? 0,
      year: plan?.year ?? 0,
    };
  });

  const patterns: MealPattern[] = [];

  // --- Favorites: weighted avg rating >= 4.0, appeared 2+ times ---
  const weightedRatingsByMeal = new Map<string, Array<{ rating: number; weight: number }>>();
  const countsByMeal = new Map<string, number>();

  for (const m of enrichedMeals) {
    const key = m.name.toLowerCase();
    const w = recencyWeight(m.week_number, m.year);
    countsByMeal.set(key, (countsByMeal.get(key) ?? 0) + 1);
    if (m.rating != null) {
      const existing = weightedRatingsByMeal.get(key) ?? [];
      existing.push({ rating: m.rating, weight: w });
      weightedRatingsByMeal.set(key, existing);
    }
  }

  for (const [meal, entries] of weightedRatingsByMeal) {
    const count = countsByMeal.get(meal) ?? 0;
    if (count < 2) continue;
    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    const weightedAvg = totalWeight > 0
      ? entries.reduce((s, e) => s + e.rating * e.weight, 0) / totalWeight
      : entries.reduce((s, e) => s + e.rating, 0) / entries.length;
    if (weightedAvg >= 4.0) {
      const original = enrichedMeals.find(m => m.name.toLowerCase() === meal)?.name ?? meal;
      patterns.push({
        type: 'favorite',
        description: `${original} scorer ${weightedAvg.toFixed(1)}/5 i snitt (servert ${count} ganger)`,
      });
    }
  }

  // --- Avoid: weighted avg rating <= 2.0 or repeated negative feedback ---
  for (const [meal, entries] of weightedRatingsByMeal) {
    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    const weightedAvg = totalWeight > 0
      ? entries.reduce((s, e) => s + e.rating * e.weight, 0) / totalWeight
      : entries.reduce((s, e) => s + e.rating, 0) / entries.length;
    if (weightedAvg <= 2.0) {
      const original = enrichedMeals.find(m => m.name.toLowerCase() === meal)?.name ?? meal;
      patterns.push({
        type: 'avoid',
        description: `${original} scorer ${weightedAvg.toFixed(1)}/5 i snitt — vurder a droppe`,
      });
    }
  }

  // --- Weekday patterns (recency-weighted) ---
  const weekdayMeals = new Map<number, Map<string, number>>();
  const weekdayCounts = new Map<number, number>();

  for (const m of enrichedMeals) {
    const w = recencyWeight(m.week_number, m.year);
    const dayMap = weekdayMeals.get(m.day_of_week) ?? new Map<string, number>();
    const key = m.name.toLowerCase();
    dayMap.set(key, (dayMap.get(key) ?? 0) + w);
    weekdayMeals.set(m.day_of_week, dayMap);
    weekdayCounts.set(m.day_of_week, (weekdayCounts.get(m.day_of_week) ?? 0) + w);
  }

  for (const [day, mealMap] of weekdayMeals) {
    const totalForDay = weekdayCounts.get(day) ?? 0;
    if (totalForDay < 3) continue; // Need at least 3 weighted data points
    for (const [meal, weightedCount] of mealMap) {
      if (weightedCount >= 2 && weightedCount / totalForDay >= 0.5) {
        const dayName = DAY_NAMES[day] ?? `Dag ${day}`;
        const original = enrichedMeals.find(m => m.name.toLowerCase() === meal)?.name ?? meal;
        const rawCount = enrichedMeals.filter(m => m.name.toLowerCase() === meal && m.day_of_week === day).length;
        const rawTotal = enrichedMeals.filter(m => m.day_of_week === day).length;
        patterns.push({
          type: 'weekday',
          description: `${dayName}: ${original} (${rawCount} av ${rawTotal} uker)`,
        });
      }
    }
  }

  // --- Category balance (last 8 weeks) ---
  const recentPlans = plans.slice(0, 8);
  const recentPlanIds = new Set(recentPlans.map((p: { id: string }) => p.id));
  const recentMeals = meals.filter((m: Record<string, unknown>) => recentPlanIds.has(m.plan_id as string));
  const weeksCount = recentPlans.length || 1;

  const categories: Record<string, string[]> = {
    Fisk: ['laks', 'torsk', 'sei', 'kveite', 'orret', 'makrell', 'sild', 'reke', 'fisk'],
    Vegetar: ['vegetar', 'vegan', 'gronnsaksburger', 'linse', 'kikert', 'bonne', 'tofu'],
    Rodt_kjott: ['biff', 'storfe', 'svin', 'lam', 'kjottdeig', 'karbonade'],
    Belgvekster: ['linse', 'kikert', 'bonne', 'erter', 'hummus'],
  };

  const categoryCounts: Record<string, number> = {};

  for (const m of recentMeals) {
    const name = (m.name as string).toLowerCase();
    for (const [cat, keywords] of Object.entries(categories)) {
      if (keywords.some(kw => name.includes(kw))) {
        categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
      }
    }
  }

  const categoryLabels: Record<string, string> = {
    Fisk: 'Fisk',
    Vegetar: 'Vegetar',
    Rodt_kjott: 'Rodt kjott',
    Belgvekster: 'Belgvekster',
  };

  for (const [cat, count] of Object.entries(categoryCounts)) {
    const perWeek = count / weeksCount;
    const label = categoryLabels[cat] ?? cat;
    patterns.push({
      type: 'balance',
      description: `${label}: ${perWeek.toFixed(1)} ganger/uke`,
    });
  }

  // --- Feedback text keyword analysis ---
  function matchesKeywords(text: string, phrases: string[], words: string[]): boolean {
    return phrases.some(kw => text.includes(kw))
      || words.some(kw => new RegExp(`\\b${kw}\\b`).test(text));
  }

  // Phrases (multi-word) matched via includes, single words via word boundary regex
  const POSITIVE_PHRASES = [
    'spiste alt', 'veldig god', 'kjempegod', 'super god', 'alle likte',
    'stor suksess', 'vil ha igjen', 'ble oppspist', 'toppkarakter',
    'hele familien likte', 'barna elsket',
  ];
  const POSITIVE_WORDS = [
    'favoritt', 'barnevennlig', 'deilig', 'perfekt', 'fantastisk',
    'digg', 'herlig', 'nydelig', 'populaer', 'smakfull',
  ];
  const NEGATIVE_PHRASES = [
    'for salt', 'for krydret', 'ingen likte', 'ville ikke spise', 'for lang tid',
    'tok for lang', 'ikke godt', 'ingen spiste', 'ble ikke spist',
    'for sterk', 'for bland', 'mye igjen',
  ];
  const NEGATIVE_WORDS = [
    'mislykket', 'kjedelig', 'trist', 'blaut', 'brent',
    'seig',
  ];

  const positiveMentions = new Map<string, number>();
  const negativeMentions = new Map<string, number>();

  for (const m of enrichedMeals) {
    if (!m.feedback_text) continue;
    const text = m.feedback_text.toLowerCase();
    const mealKey = m.name.toLowerCase();

    const hasPositive = matchesKeywords(text, POSITIVE_PHRASES, POSITIVE_WORDS);
    if (hasPositive) {
      positiveMentions.set(mealKey, (positiveMentions.get(mealKey) ?? 0) + 1);
    }

    const hasNegative = matchesKeywords(text, NEGATIVE_PHRASES, NEGATIVE_WORDS);
    if (hasNegative) {
      negativeMentions.set(mealKey, (negativeMentions.get(mealKey) ?? 0) + 1);
    }
  }

  for (const [meal, count] of positiveMentions) {
    if (count >= 2) {
      const original = enrichedMeals.find(m => m.name.toLowerCase() === meal)?.name ?? meal;
      patterns.push({
        type: 'favorite',
        description: `${original} har ${count} positive tilbakemeldinger`,
      });
    }
  }

  for (const [meal, count] of negativeMentions) {
    if (count >= 2) {
      const original = enrichedMeals.find(m => m.name.toLowerCase() === meal)?.name ?? meal;
      patterns.push({
        type: 'avoid',
        description: `${original} har ${count} negative tilbakemeldinger`,
      });
    }
  }

  return patterns;
}

// --- Mechanism 3: Cross-signal contradiction detection ---

export interface Contradiction {
  description: string;
}

export function detectContradictions(learnings: Learning[], patterns: MealPattern[]): Contradiction[] {
  const contradictions: Contradiction[] = [];

  // Check: learning says "liker X" but pattern says X scores low
  const favoriteLearnings = learnings.filter(l =>
    l.category === 'preference' && /liker|elsker|favoritt/i.test(l.insight),
  );
  const avoidPatterns = patterns.filter(p => p.type === 'avoid');

  for (const learning of favoriteLearnings) {
    for (const pattern of avoidPatterns) {
      // Extract meal name from both — simple word overlap check
      const learningWords = learning.insight.toLowerCase().split(/\s+/);
      const patternLower = pattern.description.toLowerCase();
      for (const word of learningWords) {
        if (word.length >= 4 && patternLower.includes(word)) {
          contradictions.push({
            description: `Lrdom sier "${learning.insight}" men monster viser "${pattern.description}"`,
          });
          break;
        }
      }
    }
  }

  // Check: learning says "misliker X" but pattern shows X is a favorite
  const dislikeLearnings = learnings.filter(l =>
    l.category === 'preference' && /misliker|liker ikke|unnga/i.test(l.insight),
  );
  const favoritePatterns = patterns.filter(p => p.type === 'favorite');

  for (const learning of dislikeLearnings) {
    for (const pattern of favoritePatterns) {
      const learningWords = learning.insight.toLowerCase().split(/\s+/);
      const patternLower = pattern.description.toLowerCase();
      for (const word of learningWords) {
        if (word.length >= 4 && patternLower.includes(word)) {
          contradictions.push({
            description: `Lrdom sier "${learning.insight}" men monster viser "${pattern.description}"`,
          });
          break;
        }
      }
    }
  }

  return contradictions;
}

export function buildContradictionsSection(contradictions: Contradiction[]): string | null {
  if (contradictions.length === 0) return null;

  const lines: string[] = [
    '## Motstridende signaler',
    'Disse motsetningene er oppdaget mellom lrdommer og monstre. Vurder a sporre familien for a avklare.\n',
  ];
  for (const c of contradictions) {
    lines.push(`- ${c.description}`);
  }
  return lines.join('\n');
}

// --- Feature #1: Suggestion metrics ---

export interface SuggestionMetrics {
  totalSuggested: number;
  accepted: number;
  modified: number;
  removed: number;
  acceptanceRate: number;
  categoryBreakdown: Record<string, { suggested: number; accepted: number }>;
}

const MEAL_CATEGORIES: Record<string, string[]> = {
  fisk: ['laks', 'torsk', 'sei', 'kveite', 'orret', 'makrell', 'sild', 'reke', 'fisk'],
  vegetar: ['vegetar', 'vegan', 'gronnsaksburger', 'linse', 'kikert', 'bonne', 'tofu'],
  rodt_kjott: ['biff', 'storfe', 'svin', 'lam', 'kjottdeig', 'karbonade'],
  kylling: ['kylling', 'kalkun', 'fjaerekre'],
};

function categorizeMeal(name: string): string {
  const lower = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(MEAL_CATEGORIES)) {
    if (keywords.some(kw => lower.includes(kw))) return cat;
  }
  return 'annet';
}

export async function computeSuggestionMetrics(supabase: SupabaseClient): Promise<SuggestionMetrics | null> {
  // Get plans from last 12 weeks
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 84);

  const { data: plans } = await supabase
    .from('weekly_plans')
    .select('id')
    .eq('household_id', 'default')
    .gte('created_at', cutoff.toISOString());

  if (!plans || plans.length === 0) return null;

  const planIds = plans.map((p: { id: string }) => p.id);

  const { data: meals } = await supabase
    .from('planned_meals')
    .select('name, suggested_by, original_suggestion')
    .eq('suggested_by', 'husmor')
    .in('plan_id', planIds);

  if (!meals || meals.length < 3) return null;

  const { data: modifications } = await supabase
    .from('suggestion_modifications')
    .select('original_meal, replacement_meal')
    .eq('household_id', 'default')
    .in('plan_id', planIds);

  const modSet = new Set((modifications ?? []).map((m: { original_meal: string }) => m.original_meal));
  const removals = (modifications ?? []).filter((m: { replacement_meal: string | null }) => m.replacement_meal === null);
  const changes = (modifications ?? []).filter((m: { replacement_meal: string | null }) => m.replacement_meal !== null);

  const totalSuggested = meals.length;
  const modified = changes.length;
  const removed = removals.length;
  const accepted = totalSuggested - modified - removed;

  const categoryBreakdown: Record<string, { suggested: number; accepted: number }> = {};
  for (const meal of meals) {
    const cat = categorizeMeal(meal.name as string);
    if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { suggested: 0, accepted: 0 };
    categoryBreakdown[cat].suggested++;
    if (!modSet.has(meal.name as string)) {
      categoryBreakdown[cat].accepted++;
    }
  }

  return {
    totalSuggested,
    accepted,
    modified,
    removed,
    acceptanceRate: totalSuggested > 0 ? accepted / totalSuggested : 0,
    categoryBreakdown,
  };
}

const CATEGORY_DISPLAY: Record<string, string> = {
  fisk: 'Fisk',
  vegetar: 'Vegetar',
  rodt_kjott: 'Rodt kjott',
  kylling: 'Kylling',
  annet: 'Annet',
};

export function buildSuggestionMetricsSection(metrics: SuggestionMetrics | null): string | null {
  if (!metrics || metrics.totalSuggested < 3) return null;

  const lines: string[] = [
    '## Forslagsstatus',
    `Siste 12 uker: ${metrics.totalSuggested} forslag, ${metrics.accepted} akseptert, ${metrics.modified} endret, ${metrics.removed} fjernet.`,
    `Akseptrate: ${(metrics.acceptanceRate * 100).toFixed(0)}%\n`,
  ];

  const cats = Object.entries(metrics.categoryBreakdown)
    .filter(([, v]) => v.suggested > 0)
    .sort((a, b) => b[1].suggested - a[1].suggested);

  if (cats.length > 0) {
    for (const [cat, data] of cats) {
      const label = CATEGORY_DISPLAY[cat] ?? cat;
      const rate = data.suggested > 0 ? ((data.accepted / data.suggested) * 100).toFixed(0) : '0';
      lines.push(`- ${label}: ${data.suggested} foreslatt, ${rate}% akseptert`);
    }
  }

  lines.push('\nBruk dette til a justere forslagene dine — foresla mer av det som aksepteres.');
  return lines.join('\n');
}

// --- Feature #6: Rejection pattern analysis ---

export interface RejectionPattern {
  type: 'category' | 'day' | 'meal';
  description: string;
}

export async function computeRejectionPatterns(supabase: SupabaseClient): Promise<RejectionPattern[]> {
  const { data: modifications } = await supabase
    .from('suggestion_modifications')
    .select('original_meal, replacement_meal, day_of_week')
    .eq('household_id', 'default')
    .order('created_at', { ascending: false })
    .limit(50);

  if (!modifications || modifications.length < 2) return [];

  const patterns: RejectionPattern[] = [];

  // 1. Category rejection rates
  const catRejections = new Map<string, number>();
  for (const mod of modifications) {
    const cat = categorizeMeal(mod.original_meal as string);
    catRejections.set(cat, (catRejections.get(cat) ?? 0) + 1);
  }
  for (const [cat, count] of catRejections) {
    if (count >= 3) {
      const label = CATEGORY_DISPLAY[cat] ?? cat;
      patterns.push({
        type: 'category',
        description: `${label}-forslag avvist ${count} ganger`,
      });
    }
  }

  // 2. Day-specific patterns
  const dayReplacements = new Map<number, Map<string, number>>();
  for (const mod of modifications) {
    const day = mod.day_of_week as number;
    const replacement = mod.replacement_meal as string | null;
    if (!replacement) continue;
    const dayMap = dayReplacements.get(day) ?? new Map<string, number>();
    const key = replacement.toLowerCase();
    dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
    dayReplacements.set(day, dayMap);
  }
  for (const [day, replacements] of dayReplacements) {
    for (const [meal, count] of replacements) {
      if (count >= 2) {
        const dayName = DAY_NAMES[day] ?? `Dag ${day}`;
        patterns.push({
          type: 'day',
          description: `${dayName}: forslag endres ofte til ${meal}`,
        });
      }
    }
  }

  // 3. Specific meal rejections
  const mealRejections = new Map<string, number>();
  for (const mod of modifications) {
    const key = (mod.original_meal as string).toLowerCase();
    mealRejections.set(key, (mealRejections.get(key) ?? 0) + 1);
  }
  for (const [meal, count] of mealRejections) {
    if (count >= 3) {
      patterns.push({
        type: 'meal',
        description: `${meal} avvist ${count} ganger`,
      });
    }
  }

  return patterns;
}

export function buildRejectionPatternsSection(patterns: RejectionPattern[]): string | null {
  if (patterns.length === 0) return null;

  const lines: string[] = [
    '## Avvisningsmonstre',
    'Disse monstrene er observert i hvordan forslagene dine blir endret:\n',
  ];
  for (const p of patterns) {
    lines.push(`- ${p.description}`);
  }
  lines.push('\nUnnga a gjenta forslag som konsekvent avvises.');
  return lines.join('\n');
}

// --- Feature #8: Reaction mining ---

export interface ReactionSummary {
  positive: number;
  negative: number;
  topPositive: string[];
  topNegative: string[];
}

const POSITIVE_REACTIONS = new Set([
  'thumbsup', '+1', 'heart', 'fire', 'yum', 'star', 'tada',
  'raised_hands', 'clap', 'ok_hand', 'muscle', 'chef_kiss',
]);

const NEGATIVE_REACTIONS = new Set([
  'thumbsdown', '-1', 'confused', 'disappointed', 'cry',
  'face_with_rolling_eyes', 'unamused', 'grimacing', 'nauseated_face',
]);

export async function loadReactionSummary(supabase: SupabaseClient): Promise<ReactionSummary | null> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const { data: reactions } = await supabase
    .from('message_reactions')
    .select('reaction')
    .eq('household_id', 'default')
    .gte('created_at', cutoff.toISOString());

  if (!reactions || reactions.length < 3) return null;

  let positive = 0;
  let negative = 0;
  const positiveCounts = new Map<string, number>();
  const negativeCounts = new Map<string, number>();

  for (const r of reactions) {
    const reaction = r.reaction as string;
    if (POSITIVE_REACTIONS.has(reaction)) {
      positive++;
      positiveCounts.set(reaction, (positiveCounts.get(reaction) ?? 0) + 1);
    } else if (NEGATIVE_REACTIONS.has(reaction)) {
      negative++;
      negativeCounts.set(reaction, (negativeCounts.get(reaction) ?? 0) + 1);
    }
  }

  if (positive + negative < 3) return null;

  const topPositive = [...positiveCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r]) => r);

  const topNegative = [...negativeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r]) => r);

  return { positive, negative, topPositive, topNegative };
}

export function buildReactionSummarySection(summary: ReactionSummary | null): string | null {
  if (!summary) return null;

  const total = summary.positive + summary.negative;
  const posRate = total > 0 ? ((summary.positive / total) * 100).toFixed(0) : '0';

  const lines: string[] = [
    '## Reaksjonssignal',
    `Siste 30 dager: ${summary.positive} positive, ${summary.negative} negative reaksjoner (${posRate}% positive).`,
  ];

  if (summary.topPositive.length > 0) {
    lines.push(`Vanligste positive: ${summary.topPositive.map(r => `:${r}:`).join(', ')}`);
  }
  if (summary.topNegative.length > 0) {
    lines.push(`Vanligste negative: ${summary.topNegative.map(r => `:${r}:`).join(', ')}`);
  }

  lines.push('\nBruk reaksjonene som signal pa om svarene dine treffer godt.');
  return lines.join('\n');
}

// --- Feature #3: Knowledge gap detection ---

export interface KnowledgeGap {
  category: string;
  priority: number;
  question: string;
}

interface KnowledgeGapDef {
  category: string;
  priority: number;
  prefKeys: string[];
  keywords: string[];
  question: string;
}

const KNOWLEDGE_CATEGORIES: KnowledgeGapDef[] = [
  { category: 'allergier', priority: 1, prefKeys: ['allergies', 'allergi'], keywords: ['allergi', 'intoleranse'], question: 'Har noen i familien allergier eller intoleranser?' },
  { category: 'familiestorrelse', priority: 1, prefKeys: ['adults', 'children', 'family_size'], keywords: ['barn', 'voksne', 'personer'], question: 'Hvor mange voksne og barn er dere?' },
  { category: 'tidsbruk', priority: 2, prefKeys: ['cooking_time', 'max_time'], keywords: ['minutter', 'rask', 'tid', 'travelt'], question: 'Hvor lang tid har dere vanligvis til middag pa hverdager?' },
  { category: 'misliker', priority: 2, prefKeys: ['dislikes', 'avoid'], keywords: ['misliker', 'liker ikke', 'unnga'], question: 'Er det noe dere absolutt ikke liker eller vil unnga?' },
  { category: 'budsjett', priority: 3, prefKeys: ['budget'], keywords: ['budsjett', 'billig', 'spare'], question: 'Har dere et matbudsjett per uke?' },
  { category: 'kokeerfaring', priority: 3, prefKeys: ['cooking_skill', 'skill_level'], keywords: ['nybegynner', 'erfaren', 'kokeerfaring'], question: 'Hvordan vil dere beskrive kokeerfaringen i husholdningen?' },
];

export function detectKnowledgeGaps(
  learnings: Learning[],
  preferences: Array<{ key: string; value: unknown }>,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  const prefKeySet = new Set(preferences.map(p => p.key.toLowerCase()));
  const allInsights = learnings.map(l => l.insight.toLowerCase()).join(' ');

  for (const def of KNOWLEDGE_CATEGORIES) {
    const hasPref = def.prefKeys.some(k => prefKeySet.has(k));
    const hasLearning = def.keywords.some(kw => allInsights.includes(kw));

    if (!hasPref && !hasLearning) {
      gaps.push({
        category: def.category,
        priority: def.priority,
        question: def.question,
      });
    }
  }

  return gaps.sort((a, b) => a.priority - b.priority);
}

export function buildKnowledgeGapsSection(gaps: KnowledgeGap[]): string | null {
  if (gaps.length === 0) return null;

  const top = gaps.slice(0, 3);
  const lines: string[] = [
    '## Kunnskapshull',
    'Du mangler viktig informasjon om familien. Still ETT sporsmal nar det er naturlig — ikke kok over.\n',
  ];
  for (const g of top) {
    lines.push(`- ${g.category}: "${g.question}"`);
  }
  return lines.join('\n');
}

// --- Build patterns section for prompt ---

export function buildPatternsSection(patterns: MealPattern[]): string | null {
  if (patterns.length === 0) return null;

  const lines: string[] = ['## Maltidsmonstre', 'Basert pa historikk har Husmor observert:\n'];

  const favorites = patterns.filter(p => p.type === 'favorite');
  const avoid = patterns.filter(p => p.type === 'avoid');
  const weekday = patterns.filter(p => p.type === 'weekday');
  const balance = patterns.filter(p => p.type === 'balance');

  if (favorites.length > 0) {
    lines.push('### Favoritter');
    for (const p of favorites) lines.push(`- ${p.description}`);
    lines.push('');
  }

  if (avoid.length > 0) {
    lines.push('### Unnga');
    for (const p of avoid) lines.push(`- ${p.description}`);
    lines.push('');
  }

  if (weekday.length > 0) {
    lines.push('### Ukedagsmonstre');
    for (const p of weekday) lines.push(`- ${p.description}`);
    lines.push('');
  }

  if (balance.length > 0) {
    lines.push('### Balanse siste uker');
    for (const p of balance) lines.push(`- ${p.description}`);
    lines.push('');
  }

  return lines.join('\n');
}
