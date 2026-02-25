import { stripJsonFences } from '../../lib/json.js';
import type { ClaudeMessage } from '../../lib/claude.js';
import {
  HusmorClaudeResponseSchema,
  type HusmorClaudeResponse,
} from './schemas.js';
import type { DbContext } from './db.js';
import {
  buildLearningsSection,
  buildPatternsSection,
  detectContradictions,
  buildContradictionsSection,
  buildSuggestionMetricsSection,
  buildRejectionPatternsSection,
  buildReactionSummarySection,
  buildKnowledgeGapsSection,
} from './learnings.js';

const PERSONA = `Du er Husmor. En tydelig, varm og bestemt skikkelse som kunne jobbet pa Sigtuna allmanna laroverk. Du har hoy standard for orden, helse og dannelse.

Du er strukturert, praktisk, ravarebevisst, lite imponert av slurv, og opptatt av rytme, tradisjon og kvalitet. Du tar valg. Du anbefaler tydelig. Du kan vaere streng nar det trengs.

Du snakker norsk, men kan bruke enkelte svenske ord nar det gir karakter. Det skal foles naturlig, ikke teatralsk.

## Kjerneprinsipper
- Helse og trivsel forst: Mat skal gi stabil energi, god magefolelse og ro i kroppen.
- Sesong og baerekraft: Bruk norske sesongravarer. Prioriter fisk, gronnsaker, belgvekster og grove korn. Moderate mengder kjott.
- Tradisjon og rytme: Ukerytme. Helgemat. Sma ritualer. Barna skal vokse opp med smak og minner.
- Null slosing: Planlegg for rester. Bruk opp det vi har for vi kjoper nytt.
- Realisme: Middager skal vaere gjennomforbare. Du optimaliserer for logistikk og hverdag. 20-45 min pa hverdager, inntil 60 min i helgen.
- Smak og kvalitet: Enkle ting gjort ordentlig. Riktig stekeskorpe. God saus nar det trengs.

## Tone
Varm, bestemt, kort og tydelig. Lite dill. Fokus pa orden og kvalitet. Ikke mas. Nar brukeren er vag, velger du en tydelig retning.

## Sprak
Skriv alltid pa norsk. Hold svarene korte og handlingsorienterte — dette er Slack, ikke en blogg.`;

const DIETARY_GUIDELINES = `## Kostrad (Helsedirektoratet / Livsmedelsverket)
Disse tallene er ufravikelige i alt du anbefaler:
- Gronnsaker/frukt: 500g+/dag, varier farger, inkluder ved hvert maltid
- Fullkorn: 90g/dag (grovt brod, havregryn, fullkornspasta)
- Fisk: 300-450g/uke (2-3 middager), minst 200g fet fisk
- Belgvekster: minst 1x/uke (bonner, linser, erter, tofu)
- Rodt kjott: maks 350g/uke, begrens bearbeidet kjott
- Meieri: 3 porsjoner/dag (ca 5dl), magre varianter
- Notter: 20-30g usaltede daglig, planteolje framfor smor
- Tallerkenen: 1/2 gronnsaker, 1/4 fullkorn/poteter, 1/4 protein
- Regelmessig maltidsrytme, barn trenger hyppigere maltider`;

const ACTIONS_DOC = `## Handlinger og responsformat
Svar ALLTID med gyldig JSON: { "reply": "...", "actions": [] }
"actions" kan vaere tom array eller utelatt. Returner KUN valid JSON.

Handlingstyper:
- add_meals: meals: [{ dayOfWeek (1=man), name, description?, mealType?, yieldsLeftovers? }]
- update_meal: dayOfWeek, name, description?, yieldsLeftovers?
- remove_meal: dayOfWeek
- set_preference: key, value
- add_inventory_note: itemName, status? (available|use_soon), quantity?
- rate_meal: dayOfWeek, feedbackEmoji?, rating? (1-5), feedbackText?
- generate_shopping_list: items: [{ name, amount?, unit?, category? }]
- update_plan_status: status (draft|proposed|approved|active|completed)
- propose_learning: category, insight, confidence?
- save_recipe: name, description?, prepTimeMin?, cookTimeMin?, servings?, ingredients? [{ name, amount?, unit? }], steps? [{ instruction, durationMin? }], linkToDayOfWeek?
- update_inventory_status: itemName, newStatus (available|use_soon|used|depleted)
- set_week_context: travelWeek?, guests?, guestCount?, holiday?, notes?
- log_child_reaction: childName, mealName, reaction (loved|liked|neutral|disliked|refused), notes?

Atferd:
- Spor "Hvordan var middagen?" nar brukeren forteller om en middag
- Bruk rate_meal med feedbackText nar brukeren gir konkret feedback
- Bruk propose_learning (maks 1/samtale) nar du ser monster — inkluder naturlig i reply
- Handleliste: grupper etter kategori, trekk fra lager/beholdning, marker use_soon som "used"
- yieldsLeftovers=true nar rester kan brukes neste dag
- set_week_context ved reise/gjester/hoytid — tilpass kompleksitet
- log_child_reaction ved barns feedback — bruk til a tilpasse retter`;

export function buildSystemPrompt(ctx: DbContext): string {
  const sections: string[] = [];

  const dateStr = new Date().toLocaleDateString('nb-NO', {
    timeZone: 'Europe/Oslo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Persona + date + dietary guidelines
  sections.push(PERSONA);
  sections.push(`\nI dag er det ${dateStr}.\nUke ${ctx.plan.weekNumber}, ${ctx.plan.year}.\n`);

  // Week context (Feature 5)
  if (ctx.plan.context) {
    const ctxParts: string[] = [];
    if (ctx.plan.context.travelWeek) ctxParts.push('Travel uke — prioriter enkle, raske middager');
    if (ctx.plan.context.guests) ctxParts.push(`Gjester${ctx.plan.context.guestCount ? ` (${ctx.plan.context.guestCount} ekstra)` : ''} — juster porsjoner`);
    if (ctx.plan.context.holiday) ctxParts.push(`Hoytid: ${ctx.plan.context.holiday} — vurder tradisjonelle retter`);
    if (ctx.plan.context.notes) ctxParts.push(ctx.plan.context.notes);
    if (ctxParts.length > 0) {
      sections.push('## Ukekontekst');
      for (const part of ctxParts) sections.push(`- ${part}`);
      sections.push('');
    }
  }

  sections.push(DIETARY_GUIDELINES);

  // Food traditions for current month
  if (ctx.foodTraditions.length > 0) {
    sections.push('\n## Mattradisjoner denne maneden');
    for (const t of ctx.foodTraditions) {
      const dishes = t.typicalDishes.length > 0 ? ` Typiske retter: ${t.typicalDishes.join(', ')}.` : '';
      const strength = t.suggestStrength === 'strong' ? ' (sterk anbefaling)' : t.suggestStrength === 'suggest' ? ' (anbefalt)' : '';
      sections.push(`- **${t.name}** (${t.country})${strength}:${dishes}${t.description ? ` ${t.description}` : ''}`);
    }
  }

  // Supplementary nutrition knowledge from DB
  if (ctx.nutritionKnowledge.length > 0) {
    sections.push('\n## Utfyllende kostholdsrad');
    const grouped = new Map<string, typeof ctx.nutritionKnowledge>();
    for (const n of ctx.nutritionKnowledge) {
      const existing = grouped.get(n.category) ?? [];
      existing.push(n);
      grouped.set(n.category, existing);
    }
    for (const [category, entries] of grouped) {
      sections.push(`\n### ${category}`);
      for (const e of entries) {
        const scope = e.appliesTo ? ` (${e.appliesTo})` : '';
        sections.push(`- **${e.topic}**${scope}: ${e.content}`);
      }
    }
  }

  // Current plan
  if (ctx.plan.meals.length > 0) {
    sections.push('\n## Gjeldende ukeplan');
    for (const m of ctx.plan.meals) {
      const desc = m.description ? ` — ${m.description}` : '';
      const leftovers = m.yieldsLeftovers ? ' (gir rester)' : '';
      let nutritionStr = '';
      if (m.nutrition) {
        const src = m.nutrition.source === 'recipe' ? 'oppskrift' : 'estimat';
        nutritionStr = ` — ${Math.round(m.nutrition.caloriesKcal)} kcal, ${Math.round(m.nutrition.proteinG)}g protein, ${Math.round(m.nutrition.fatG)}g fett (${src})`;
      }
      sections.push(`- ${m.dayName}: ${m.name}${desc}${leftovers}${nutritionStr}`);
    }
    sections.push(`Status: ${ctx.plan.status}`);
  } else {
    sections.push('\n## Gjeldende ukeplan\nIngen plan enna for denne uken.');
  }

  // Preferences
  if (ctx.preferences.length > 0) {
    sections.push('\n## Familiepreferanser');
    for (const p of ctx.preferences) {
      sections.push(`- ${p.key}: ${JSON.stringify(p.value)}`);
    }
  }

  // Learnings from previous conversations
  const learningsSection = buildLearningsSection(ctx.learnings);
  if (learningsSection) {
    sections.push(`\n${learningsSection}`);
    sections.push(`\n## Bruk det du har laert
Vis aktivt at du husker og bruker lerdommene over. Eksempler:
- "Jeg vet dere liker laks, sa hva med laks i dag?"
- "Siden barna elsket kyllinggryte sist, foreslar jeg det igjen"
- "Dere foretrekker raske middager pa tirsdager, sa her er et 20-minuttersforslag"
Ikke bare list opp lerdommer — flett dem naturlig inn i svarene dine. Det viser at du kjenner familien.`);
  }

  // Meal patterns
  const patternsSection = buildPatternsSection(ctx.mealPatterns);
  if (patternsSection) {
    sections.push(`\n${patternsSection}`);
  }

  // Contradictions (Feature 4)
  const contradictions = detectContradictions(ctx.learnings, ctx.mealPatterns);
  const contradictionsSection = buildContradictionsSection(contradictions);
  if (contradictionsSection) {
    sections.push(`\n${contradictionsSection}`);
  }

  // Suggestion feedback (Feature #1)
  const suggestionSection = buildSuggestionMetricsSection(ctx.suggestionMetrics);
  if (suggestionSection) {
    sections.push(`\n${suggestionSection}`);
  }

  // Rejection patterns (Feature #6)
  const rejectionSection = buildRejectionPatternsSection(ctx.rejectionPatterns);
  if (rejectionSection) {
    sections.push(`\n${rejectionSection}`);
  }

  // Reaction signals (Feature #8)
  const reactionSection = buildReactionSummarySection(ctx.reactionSummary);
  if (reactionSection) {
    sections.push(`\n${reactionSection}`);
  }

  // Knowledge gaps (Feature #3)
  const knowledgeSection = buildKnowledgeGapsSection(ctx.knowledgeGaps);
  if (knowledgeSection) {
    sections.push(`\n${knowledgeSection}`);
  }

  // Pantry staples
  if (ctx.pantryStaples.length > 0) {
    sections.push(`\n## Alltid pa lager\n${ctx.pantryStaples.join(', ')}`);
  }

  // Inventory notes
  if (ctx.inventoryNotes.length > 0) {
    sections.push('\n## Ma brukes opp');
    for (const n of ctx.inventoryNotes) {
      const qty = n.quantity ? ` (${n.quantity})` : '';
      sections.push(`- ${n.itemName}${qty} — ${n.status}`);
    }
  }

  // Seasonal
  if (ctx.seasonalProduce.length > 0) {
    sections.push(`\n## I sesong na\n${ctx.seasonalProduce.join(', ')}`);
  }

  // Child taste profiles (Feature 6)
  if (ctx.childReactions.length > 0) {
    sections.push('\n## Barnas smaksprofiler');
    const byChild = new Map<string, typeof ctx.childReactions>();
    for (const r of ctx.childReactions) {
      const existing = byChild.get(r.childName) ?? [];
      existing.push(r);
      byChild.set(r.childName, existing);
    }
    for (const [child, reactions] of byChild) {
      sections.push(`\n### ${child}`);
      const loved = reactions.filter(r => r.reaction === 'loved' || r.reaction === 'liked');
      const disliked = reactions.filter(r => r.reaction === 'disliked' || r.reaction === 'refused');
      if (loved.length > 0) sections.push(`Liker: ${loved.map(r => r.mealName).join(', ')}`);
      if (disliked.length > 0) sections.push(`Liker ikke: ${disliked.map(r => r.mealName).join(', ')}`);
    }
    sections.push('\nBruk barnas smaksprofiler til a gradvis utvide paletten. Introduser nye smaker i kjente kombinasjoner.');
  }

  // Recent meals (last 3 weeks)
  if (ctx.recentMeals.length > 0) {
    sections.push('\n## Nylige middager');
    const byWeek = new Map<string, typeof ctx.recentMeals>();
    for (const m of ctx.recentMeals) {
      const key = `Uke ${m.weekNumber}, ${m.year}`;
      const existing = byWeek.get(key) ?? [];
      existing.push(m);
      byWeek.set(key, existing);
    }
    for (const [weekLabel, meals] of byWeek) {
      sections.push(`\n### ${weekLabel}`);
      for (const m of meals) {
        const feedback = m.feedbackEmoji ? ` ${m.feedbackEmoji}` : '';
        const rating = m.rating ? ` (${m.rating}/5)` : '';
        const text = m.feedbackText ? ` — "${m.feedbackText}"` : '';
        sections.push(`- ${m.dayName}: ${m.name}${feedback}${rating}${text}`);
      }
    }
    sections.push('\nBruk nylige middager til a unnga gjentakelser og ta hensyn til feedback.');
  }

  // Nutrition balance from Matvaretabellen
  sections.push(`\n## Naeringsbalanse og ernaeringssporing
Nar du lager eller vurderer en ukeplan, tell opp:
- Fiskedager (mal: 2-3)
- Vegetardager (mal: minst 1)
- Rodt kjott-dager (mal: maks 2, helst 1)
- Belgvekst-dager (mal: minst 1)
Sammenlikn med kostradene over. Gi kort tilbakemelding om balansen er god eller hva som kan forbedres.`);

  if (ctx.weeklyNutrition) {
    const wn = ctx.weeklyNutrition;
    const t = wn.totals;
    sections.push(`\n## Naeringsdata fra Matvaretabellen
Du har tilgang til faktiske naeringsverdier fra den norske matvaretabellen (2121 matvarer).
Oppskrifter med ingredienser berikes automatisk med naeringsdata per porsjon.

Ukens naeringsbalanse (middager med data: ${wn.mealsWithData}/${wn.totalMeals}):
- Kalorier: ${Math.round(t.caloriesKcal)} kcal | Protein: ${Math.round(t.proteinG)}g | Fett: ${Math.round(t.fatG)}g | Karbo: ${Math.round(t.carbsG)}g | Fiber: ${Math.round(t.fiberG)}g
- Jern: ${t.ironMg.toFixed(1)}mg | Omega-3: ${t.omega3G.toFixed(1)}g | D-vitamin: ${t.vitaminDUg.toFixed(1)}ug | Kalsium: ${Math.round(t.calciumMg)}mg

Bruk disse tallene aktivt:
- Papek mangler ("Ukeplanen er lav pa omega-3 — legg til en fiskemiddag")
- Begrunn forslag med data ("Laks gir 2.4g omega-3 per porsjon")
- Nar brukeren ber om naeringsoversikt, referer til de faktiske tallene
- For maltider uten data, oppfordre til a lagre oppskriften (save_recipe) for a fa naeringsberegning`);
  } else {
    sections.push(`\n## Naeringsdata fra Matvaretabellen
Du har tilgang til faktiske naeringsverdier fra den norske matvaretabellen (2121 matvarer).
Oppskrifter med ingredienser berikes automatisk med naeringsdata per porsjon.
Ingen av ukens maltider har naeringsdata enna. Oppfordre brukeren til a lagre oppskrifter (save_recipe) for a fa beregning.`);
  }

  // Saved recipes
  if (ctx.savedRecipes.length > 0) {
    sections.push('\n## Lagrede oppskrifter');
    for (const r of ctx.savedRecipes) {
      const time = [r.prepTimeMin && `prep ${r.prepTimeMin}min`, r.cookTimeMin && `tilb ${r.cookTimeMin}min`].filter(Boolean).join(', ');
      const rating = r.avgRating ? ` (${r.avgRating.toFixed(1)}/5)` : '';
      const lastUsed = r.lastUsedWeek ? ` — sist uke ${r.lastUsedWeek}/${r.lastUsedYear}` : '';
      sections.push(`- ${r.name}${time ? ` [${time}]` : ''}${rating}${lastUsed}`);
    }
  }

  // Recipe instruction (Feature 3: aktiv gjenbruk)
  sections.push(`\n## Oppskrifter
Nar du planlegger middager, foresla lagrede oppskrifter med hoy rating for du genererer nye.
Nar brukeren ber om oppskrift, sjekk forst om det finnes en lagret oppskrift.
Nar brukeren er fornoyd med en generert oppskrift, bruk save_recipe for a lagre den.
Generer steg-for-steg instruksjoner i svaret ditt. Inkluder ingrediensliste med mengder, og estimer total tid.`);

  // Actions documentation + response format
  sections.push(`\n${ACTIONS_DOC}`);

  return sections.join('\n');
}

export function parseClaudeResponse(text: string): HusmorClaudeResponse {
  const jsonStr = stripJsonFences(text);

  try {
    const parsed = JSON.parse(jsonStr);
    return HusmorClaudeResponseSchema.parse(parsed);
  } catch {
    // Zod validation may fail on actions (e.g. type mismatches) while reply is fine.
    // Try to salvage the reply field from valid JSON.
    try {
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed.reply === 'string') {
        return { reply: parsed.reply, actions: [] };
      }
    } catch {
      // Not valid JSON at all
    }
    // Claude sometimes responds in plain text despite JSON instructions.
    return { reply: text.trim(), actions: [] };
  }
}

/** Build a system prompt for proactive messages that includes full DB context. */
export function buildProactiveSystemPrompt(ctx: DbContext): string {
  const sections: string[] = [];

  sections.push(`Du er Husmor, en varm og bestemt matplanlegger for en norsk familie. Du sender en proaktiv melding — ingen har spurt deg, sa vaer ekstra vennlig og naturlig. Skriv ren tekst pa norsk, ikke JSON.`);

  const dateStr = new Date().toLocaleDateString('nb-NO', {
    timeZone: 'Europe/Oslo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  sections.push(`\nI dag er det ${dateStr}.\nUke ${ctx.plan.weekNumber}, ${ctx.plan.year}.\n`);

  // Learnings
  const learningsSection = buildLearningsSection(ctx.learnings);
  if (learningsSection) {
    sections.push(learningsSection);
    sections.push('Bruk lerdommene naturlig — vis at du kjenner familien.');
  }

  // Patterns
  const patternsSection = buildPatternsSection(ctx.mealPatterns);
  if (patternsSection) {
    sections.push(patternsSection);
  }

  // Current plan
  if (ctx.plan.meals.length > 0) {
    sections.push('\n## Gjeldende ukeplan');
    for (const m of ctx.plan.meals) {
      const desc = m.description ? ` — ${m.description}` : '';
      sections.push(`- ${m.dayName}: ${m.name}${desc}`);
    }
  }

  // Preferences
  if (ctx.preferences.length > 0) {
    sections.push('\n## Familiepreferanser');
    for (const p of ctx.preferences) {
      sections.push(`- ${p.key}: ${JSON.stringify(p.value)}`);
    }
  }

  // Seasonal
  if (ctx.seasonalProduce.length > 0) {
    sections.push(`\n## I sesong na\n${ctx.seasonalProduce.join(', ')}`);
  }

  // Inventory
  if (ctx.inventoryNotes.length > 0) {
    sections.push('\n## Ma brukes opp');
    for (const n of ctx.inventoryNotes) {
      const qty = n.quantity ? ` (${n.quantity})` : '';
      sections.push(`- ${n.itemName}${qty} — ${n.status}`);
    }
  }

  return sections.join('\n');
}

/** Ensure messages alternate user/assistant and start with user (Claude API requirement) */
export function cleanMessageOrder(messages: ClaudeMessage[]): ClaudeMessage[] {
  if (messages.length === 0) return [];

  const result: ClaudeMessage[] = [];
  for (const msg of messages) {
    const prev = result[result.length - 1];
    // Merge consecutive same-role messages
    if (prev && prev.role === msg.role) {
      prev.content += '\n' + msg.content;
    } else {
      result.push({ ...msg });
    }
  }

  // Must start with user
  while (result.length > 0 && result[0].role !== 'user') {
    result.shift();
  }

  // Must end with user
  while (result.length > 0 && result[result.length - 1].role !== 'user') {
    result.pop();
  }

  return result.length > 0 ? result : [{ role: 'user', content: '' }];
}
