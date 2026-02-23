import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { callClaude, extractText } from '../../lib/claude.js';
import { getEnv } from '../../lib/env.js';

import {
  MealPlanInputSchema,
  MealPlanOutputSchema,
  type MealPlanInput,
  type MealPlanOutput,
} from './schemas.js';

const DEFAULT_HOUSEHOLD_ID = 'default';
const DEFAULT_DAYS_TO_PLAN = 7;
const DEFAULT_MEALS_PER_DAY = 1;

const DAY_NAMES: Record<number, string> = {
  1: 'Mandag',
  2: 'Tirsdag',
  3: 'Onsdag',
  4: 'Torsdag',
  5: 'Fredag',
  6: 'Lordag',
  7: 'Sondag',
};

interface ResolvedInput {
  weekNumber: number;
  year: number;
  householdId: string;
  family?: MealPlanInput['family'];
  seasonalProduce: NonNullable<MealPlanInput['seasonalProduce']>;
  traditions: NonNullable<MealPlanInput['traditions']>;
  recentMeals: NonNullable<MealPlanInput['recentMeals']>;
  nutritionGuidelines: NonNullable<MealPlanInput['nutritionGuidelines']>;
  pantryStaples: string[];
  inventoryNotes: NonNullable<MealPlanInput['inventoryNotes']>;
  daysToPlan: number;
  mealsPerDay: number;
}

function resolveDefaults(input: MealPlanInput): ResolvedInput {
  return {
    weekNumber: input.weekNumber,
    year: input.year,
    householdId: input.householdId ?? DEFAULT_HOUSEHOLD_ID,
    family: input.family,
    seasonalProduce: input.seasonalProduce ?? [],
    traditions: input.traditions ?? [],
    recentMeals: input.recentMeals ?? [],
    nutritionGuidelines: input.nutritionGuidelines ?? [],
    pantryStaples: input.pantryStaples ?? [],
    inventoryNotes: input.inventoryNotes ?? [],
    daysToPlan: input.daysToPlan ?? DEFAULT_DAYS_TO_PLAN,
    mealsPerDay: input.mealsPerDay ?? DEFAULT_MEALS_PER_DAY,
  };
}

function buildSystemPrompt(input: ResolvedInput): string {
  const sections: string[] = [];

  sections.push(`Du er Husmor. En tydelig, varm og bestemt skikkelse som kunne jobbet pa Sigtuna allmanna laroverk. Du har hoy standard for orden, helse og dannelse. Du planlegger ukentlige middager som er naerende, sesongbaserte, varierte og barnevennlige.

Du er strukturert, praktisk, ravarebevisst, lite imponert av slurv, og opptatt av rytme, tradisjon og kvalitet. Du tar valg og anbefaler tydelig. Skriv alltid pa norsk, men du kan bruke enkelte svenske ord nar det gir karakter.

Kjerneprinsipper:
- Helse forst: Mat skal gi stabil energi og god magefolelse.
- Sesong og baerekraft: Norske sesongravarer. Fisk, gronnsaker, belgvekster, grove korn. Moderate mengder kjott.
- Tradisjon og rytme: Helgemat skal foles som helg. Sma ritualer. Barna skal vokse opp med smak og minner.
- Null slosing: Planlegg for rester. Bruk opp det vi har for vi kjoper nytt.
- Smak og kvalitet: Enkle ting gjort ordentlig.

Regler for ukeplanen:
- Planlegg ${input.daysToPlan} middager (${input.mealsPerDay} maltid per dag)
- Minst 2 fiskedager per uke
- Minst 1 vegetardag
- Maks 2 middager med rodt kjott
- 1 dag bor egne seg for batch cooking (lag ekstra til fryseren)
- 1-2 planlagte restebruk
- Lordagsmat som foles som helg
- Varier mellom ulike proteinkilder og tilberedningsmetoder
- Tilpas til familiens allergier og preferanser
- Bruk sesongvarer nar mulig
- Hold matretter realistisk — 20-45 min tilberedning pa hverdager, inntil 60 min i helgen`);

  if (input.family) {
    const f = input.family;
    sections.push(`\n## Familien
- ${f.adults} voksne, ${f.children} barn
- Allergier: ${f.allergies.length > 0 ? f.allergies.join(', ') : 'ingen'}
- Liker ikke: ${f.dislikes.length > 0 ? f.dislikes.join(', ') : 'ingenting spesielt'}
- Matpreferanser: ${f.cuisinePreferences.length > 0 ? f.cuisinePreferences.join(', ') : 'variert'}`);
  }

  if (input.seasonalProduce.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const p of input.seasonalProduce) {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push(p.name);
    }
    const lines = Object.entries(grouped)
      .map(([cat, items]) => `- ${cat}: ${items.join(', ')}`)
      .join('\n');
    sections.push(`\n## Sesongvarer akkurat na\n${lines}\nBruk gjerne disse i ukeplanen for best smak og pris.`);
  }

  if (input.traditions.length > 0) {
    const lines = input.traditions
      .map((t) => `- **${t.name}** (${t.country}): ${t.description} [Forslag: ${t.suggestStrength}]`)
      .join('\n');
    sections.push(`\n## Mattradisjoner denne perioden\n${lines}\nTa hensyn til tradisjoner markert 'strong' — de andre er valgfrie.`);
  }

  if (input.nutritionGuidelines.length > 0) {
    const lines = input.nutritionGuidelines
      .map((g) => `- ${g.topic}: ${g.content}`)
      .join('\n');
    sections.push(`\n## Naeringsrad\n${lines}`);
  }

  if (input.pantryStaples.length > 0) {
    sections.push(`\n## Alltid pa lager (ikke ta med i handleliste)
${input.pantryStaples.join(', ')}`);
  }

  sections.push(`\nReturner et JSON-objekt med noyaktig denne strukturen:
{
  "weekNumber": ${input.weekNumber},
  "year": ${input.year},
  "meals": [
    {
      "dayOfWeek": 1,
      "dayName": "Mandag",
      "name": "Rettnavn",
      "description": "Kort beskrivelse av retten",
      "estimatedPrepMin": 30,
      "tags": ["fisk", "barnevennlig"],
      "keyNutrients": ["omega-3", "D-vitamin"],
      "seasonalIngredients": ["laks"],
      "childTip": "Tips for a gjore retten barnevennlig",
      "batchNote": "Lag dobbel porsjon og frys resten",
      "ingredients": [{ "name": "Laks", "amount": "600g" }]
    }
  ],
  "weekSummary": "Oppsummering av uken pa norsk — din 'husmor'-kommentar",
  "nutritionNotes": "Analyse av ukens naeringsbalanse",
  "seasonalHighlight": "Hva som er i sesong og hvordan det er brukt",
  "traditionNote": "Eventuell tradisjon som er innlemmet",
  "shoppingHighlights": ["Laks", "Brokkoli", "Kylling"],
  "hasMeals": true
}

Dagnavn pa norsk: Mandag, Tirsdag, Onsdag, Torsdag, Fredag, Lordag, Sondag.
Returner KUN valid JSON, ingen annen tekst.`);

  return sections.join('\n');
}

function buildUserPrompt(input: ResolvedInput): string {
  const lines: string[] = [];

  lines.push(`Lag en ukeplan for uke ${input.weekNumber}, ${input.year}.`);
  lines.push(`Planlegg ${input.daysToPlan} middager.\n`);

  if (input.recentMeals.length > 0) {
    lines.push('## Nylige middager (unnga gjentakelser)');
    for (const meal of input.recentMeals) {
      const dayName = DAY_NAMES[meal.dayOfWeek] ?? `Dag ${meal.dayOfWeek}`;
      const emoji = meal.feedbackEmoji ? ` (${meal.feedbackEmoji})` : '';
      lines.push(`- ${dayName}: ${meal.name}${emoji}`);
    }
    lines.push('');
  }

  if (input.inventoryNotes.length > 0) {
    lines.push('## Ma brukes opp snart');
    for (const note of input.inventoryNotes) {
      const qty = note.quantity ? ` (${note.quantity})` : '';
      lines.push(`- ${note.itemName}${qty} — ${note.status}`);
    }
    lines.push('');
  }

  lines.push('Lag planen na. Husk a variere proteinkilder og bruke sesongvarer.');

  return lines.join('\n');
}

async function execute(
  rawInput: MealPlanInput,
  _ctx: AgentContext,
): Promise<AgentResult<MealPlanOutput>> {
  const input = resolveDefaults(rawInput);

  const env = getEnv();
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for meal-plan agent');
  }

  const systemPrompt = buildSystemPrompt(input);
  const userPrompt = buildUserPrompt(input);

  const response = await callClaude(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = extractText(response);

  // Strip markdown fences if present
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr);
  const output = MealPlanOutputSchema.parse(parsed);

  // Build a human-readable markdown artifact
  const markdownLines: string[] = [];
  markdownLines.push(`# Ukeplan — Uke ${output.weekNumber}, ${output.year}\n`);
  markdownLines.push(`${output.weekSummary}\n`);

  for (const meal of output.meals) {
    markdownLines.push(`---\n`);
    markdownLines.push(`## ${meal.dayName}: ${meal.name}\n`);
    markdownLines.push(`${meal.description}\n`);
    markdownLines.push(`**Tid:** ca ${meal.estimatedPrepMin} min | **Tags:** ${meal.tags.join(', ')}`);
    if (meal.keyNutrients.length > 0) {
      markdownLines.push(`**Naering:** ${meal.keyNutrients.join(', ')}`);
    }
    if (meal.seasonalIngredients.length > 0) {
      markdownLines.push(`**Sesongvarer:** ${meal.seasonalIngredients.join(', ')}`);
    }
    if (meal.childTip) {
      markdownLines.push(`**Barnetips:** ${meal.childTip}`);
    }
    if (meal.batchNote) {
      markdownLines.push(`**Batch:** ${meal.batchNote}`);
    }
    markdownLines.push('');
  }

  if (output.nutritionNotes) {
    markdownLines.push(`---\n`);
    markdownLines.push(`## Naeringsbalanse\n${output.nutritionNotes}\n`);
  }

  if (output.seasonalHighlight) {
    markdownLines.push(`## Sesongfokus\n${output.seasonalHighlight}\n`);
  }

  if (output.traditionNote) {
    markdownLines.push(`## Tradisjon\n${output.traditionNote}\n`);
  }

  if (output.shoppingHighlights.length > 0) {
    markdownLines.push(`## Handleliste (hovedvarer)\n`);
    for (const item of output.shoppingHighlights) {
      markdownLines.push(`- ${item}`);
    }
    markdownLines.push('');
  }

  return {
    output,
    artifacts: output.hasMeals
      ? [
          {
            kind: 'weekly-meal-plan',
            content: markdownLines.join('\n'),
            meta: {
              weekNumber: output.weekNumber,
              year: output.year,
              mealCount: output.meals.length,
              householdId: input.householdId,
            },
          },
        ]
      : [],
  };
}

export const mealPlanAgent: AgentDefinition<MealPlanInput, MealPlanOutput> = {
  name: 'meal-plan',
  version: '0.1',
  inputSchema: MealPlanInputSchema,
  outputSchema: MealPlanOutputSchema,
  execute,
};
