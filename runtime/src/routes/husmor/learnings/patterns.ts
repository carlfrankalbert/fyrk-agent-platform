import type { SupabaseClient } from '@supabase/supabase-js';
import { DAY_NAMES } from '../../../lib/constants.js';
import type { Learning } from './extraction.js';

// --- Types ---

export interface MealPattern {
  type: 'favorite' | 'avoid' | 'weekday' | 'balance';
  description: string;
}

interface MealRow {
  name: string;
  day_of_week: number;
  rating: number | null;
  feedback_emoji: string | null;
  feedback_text: string | null;
  week_number: number;
  year: number;
}

export interface Contradiction {
  description: string;
}

// --- Mechanism 2: Meal pattern analysis ---

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
