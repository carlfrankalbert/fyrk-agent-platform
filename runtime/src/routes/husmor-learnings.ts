import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callClaude, extractText } from '../lib/claude.js';
import type { ClaudeMessage } from '../lib/claude.js';
import { stripJsonFences } from '../lib/json.js';
import { DAY_NAMES } from '../lib/constants.js';

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

type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

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
  // Guard: minimum 3 user messages
  const userMessageCount = messages.filter(m => m.role === 'user').length;
  if (userMessageCount < 3) return;

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
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: conversationText }],
  });

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
  const { data } = await supabase
    .from('household_learnings')
    .select('id, category, insight, confidence, confirmed, source')
    .eq('household_id', 'default')
    .is('superseded_by', null)
    .not('confirmed', 'eq', false)
    .gte('confidence', 0.5)
    .order('created_at', { ascending: false })
    .limit(30);

  // Filter out expired (can't do expires_at > now() easily in supabase-js with OR null)
  const now = new Date().toISOString();
  return (data ?? []).filter((l: Record<string, unknown>) => {
    const expires = l.expires_at as string | null;
    return !expires || expires > now;
  }).map((l: Record<string, unknown>) => ({
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
  const planLookup = new Map(plans.map((p: { id: string; week_number: number }) => [p.id, p]));

  const { data: meals } = await supabase
    .from('planned_meals')
    .select('plan_id, name, day_of_week, rating, feedback_emoji, feedback_text')
    .in('plan_id', planIds);

  if (!meals || meals.length === 0) return [];

  const enrichedMeals: MealRow[] = meals.map((m: Record<string, unknown>) => {
    const plan = planLookup.get(m.plan_id as string) as { week_number: number } | undefined;
    return {
      name: m.name as string,
      day_of_week: m.day_of_week as number,
      rating: m.rating as number | null,
      feedback_emoji: m.feedback_emoji as string | null,
      feedback_text: (m.feedback_text as string | null) ?? null,
      week_number: plan?.week_number ?? 0,
    };
  });

  const patterns: MealPattern[] = [];

  // --- Favorites: avg rating >= 4.0, appeared 2+ times ---
  const ratingsByMeal = new Map<string, number[]>();
  const countsByMeal = new Map<string, number>();

  for (const m of enrichedMeals) {
    const key = m.name.toLowerCase();
    countsByMeal.set(key, (countsByMeal.get(key) ?? 0) + 1);
    if (m.rating != null) {
      const existing = ratingsByMeal.get(key) ?? [];
      existing.push(m.rating);
      ratingsByMeal.set(key, existing);
    }
  }

  for (const [meal, ratings] of ratingsByMeal) {
    const count = countsByMeal.get(meal) ?? 0;
    if (count < 2) continue;
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    if (avg >= 4.0) {
      // Find original casing
      const original = enrichedMeals.find(m => m.name.toLowerCase() === meal)?.name ?? meal;
      patterns.push({
        type: 'favorite',
        description: `${original} scorer ${avg.toFixed(1)}/5 i snitt (servert ${count} ganger)`,
      });
    }
  }

  // --- Avoid: avg rating <= 2.0 or repeated negative feedback ---
  for (const [meal, ratings] of ratingsByMeal) {
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    if (avg <= 2.0) {
      const original = enrichedMeals.find(m => m.name.toLowerCase() === meal)?.name ?? meal;
      patterns.push({
        type: 'avoid',
        description: `${original} scorer ${avg.toFixed(1)}/5 i snitt — vurder a droppe`,
      });
    }
  }

  // --- Weekday patterns ---
  const weekdayMeals = new Map<number, Map<string, number>>();
  const weekdayCounts = new Map<number, number>();

  for (const m of enrichedMeals) {
    const dayMap = weekdayMeals.get(m.day_of_week) ?? new Map<string, number>();
    const key = m.name.toLowerCase();
    dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
    weekdayMeals.set(m.day_of_week, dayMap);
    weekdayCounts.set(m.day_of_week, (weekdayCounts.get(m.day_of_week) ?? 0) + 1);
  }

  for (const [day, mealMap] of weekdayMeals) {
    const totalForDay = weekdayCounts.get(day) ?? 0;
    if (totalForDay < 3) continue; // Need at least 3 data points
    for (const [meal, count] of mealMap) {
      if (count >= 3 && count / totalForDay >= 0.5) {
        const dayName = DAY_NAMES[day] ?? `Dag ${day}`;
        const original = enrichedMeals.find(m => m.name.toLowerCase() === meal)?.name ?? meal;
        patterns.push({
          type: 'weekday',
          description: `${dayName}: ${original} (${count} av ${totalForDay} uker)`,
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
  const POSITIVE_KEYWORDS = ['spiste alt', 'favoritt', 'barnevennlig', 'kjempegod', 'veldig god'];
  const NEGATIVE_KEYWORDS = ['for salt', 'for krydret', 'ingen likte', 'ville ikke spise', 'for lang tid'];

  const positiveMentions = new Map<string, number>();
  const negativeMentions = new Map<string, number>();

  for (const m of enrichedMeals) {
    if (!m.feedback_text) continue;
    const text = m.feedback_text.toLowerCase();
    const mealKey = m.name.toLowerCase();

    for (const kw of POSITIVE_KEYWORDS) {
      if (text.includes(kw)) {
        positiveMentions.set(mealKey, (positiveMentions.get(mealKey) ?? 0) + 1);
      }
    }
    for (const kw of NEGATIVE_KEYWORDS) {
      if (text.includes(kw)) {
        negativeMentions.set(mealKey, (negativeMentions.get(mealKey) ?? 0) + 1);
      }
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
