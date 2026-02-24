import { stripJsonFences } from '../lib/json.js';
import type { ClaudeMessage } from '../lib/claude.js';
import {
  HusmorClaudeResponseSchema,
  type HusmorClaudeResponse,
} from './husmor-schemas.js';
import type { DbContext } from './husmor-db.js';
import {
  buildLearningsSection,
  buildPatternsSection,
  detectContradictions,
  buildContradictionsSection,
  buildSuggestionMetricsSection,
  buildRejectionPatternsSection,
  buildReactionSummarySection,
  buildKnowledgeGapsSection,
} from './husmor-learnings.js';

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

const DIETARY_GUIDELINES = `## Kostrad — Helsedirektoratet (Norge) og Livsmedelsverket (Sverige)
Du folger disse offisielle kostradene. De er ikke valgfrie — de er grunnmuren i alt du anbefaler.

### Gronnsaker, frukt og baer
- Minst 5 porsjoner daglig, helst 8. En porsjon = 100g.
- Halvparten gronnsaker, halvparten frukt/baer. Varier farger.
- Inkluder ved hvert maltid, ogsa mellommaltider.
- Sverige: minst 500g daglig, gjerne mer.

### Fullkorn
- Minst 90g fullkorn daglig, fordelt pa minst 2 maltider.
- Velg grovt brod (minst 75% fullkorn), knekkerod, havregryn, fullkornspasta.

### Fisk og sjomat
- 300-450g per uke (2-3 middager). Minst 200g skal vaere fet fisk (laks, orret, makrell, sild).
- En middagsporsjon = 150-200g.

### Belgvekster
- Minst 1 gang per uke som hovedrett eller tilbehor. Sverige: gjerne daglig.
- Bonner, linser, erter, hummus, tofu.

### Kjott
- Rodt kjott (storfe, svin, lam): maks 350g per uke. Begrens bearbeidet kjott (polse, bacon, salami).
- Velg hvitt kjott (kylling, kalkun) framfor rodt.
- Bade Norge og Sverige senket grensen til 350g/uke.

### Meieriprodukter
- 3 porsjoner daglig (ca 5dl totalt). Velg magre varianter.
- 2 porsjoner bor vaere melk/yoghurt (for jod).

### Fett og noetter
- Bruk planteolje (raps, oliven) i stedet for smor.
- 20-30g usaltede notter daglig.

### Sukker, snacks og drikke
- Begrens godteri, chips, kaker, brus, energidrikk.
- Drikk vann. Kaffe 1-4 kopper filtrert for voksne.
- Barn under 3: unnga kunstige sotningsmilder.

### Tallerkenen
- Halve tallerkenen: gronnsaker/frukt/baer.
- En fjerdedel: karbohydrater (fullkorn, poteter).
- En fjerdedel: protein (fisk, belgvekster, egg, meieri, magert kjott).

### Maltidsrytme
- Regelmessige maltider gir stabil energi.
- Barn trenger hyppigere maltider.

Kilder: Helsedirektoratet (oppdatert aug 2024), Livsmedelsverket (nye kostrad 2025).`;

const ACTIONS_DOC = `## Tilgjengelige handlinger
Du kan utfore handlinger ved a inkludere dem i "actions"-arrayen i JSON-svaret ditt.

Handlingstyper:
- add_meals: Legg til maltider. meals: [{ dayOfWeek (1=mandag), name, description?, mealType?, yieldsLeftovers? }]
- update_meal: Oppdater et maltid. dayOfWeek, name, description?, yieldsLeftovers?
- remove_meal: Fjern et maltid. dayOfWeek
- set_preference: Sett en preferanse. key, value
- add_inventory_note: Legg til beholdningsnotat. itemName, status? (available|use_soon), quantity?
- rate_meal: Gi tilbakemelding pa et maltid. dayOfWeek, feedbackEmoji?, rating? (1-5), feedbackText? (kort fritekst om smak/tid/barnevennlighet)
- generate_shopping_list: Generer handleliste. items: [{ name, amount?, unit?, category? }]
- update_plan_status: Oppdater planstatus. status (draft|proposed|approved|active|completed)
- propose_learning: Foresla en observasjon for bekreftelse. category, insight, confidence?
- save_recipe: Lagre en oppskrift. name, description?, prepTimeMin?, cookTimeMin?, servings?, ingredients? [{ name, amount?, unit? }], steps? [{ instruction, durationMin? }], linkToDayOfWeek?
- update_inventory_status: Oppdater status pa en vare. itemName, newStatus (available|use_soon|used|depleted)
- set_week_context: Sett ukekontekst. travelWeek?, guests?, guestCount?, holiday?, notes?
- log_child_reaction: Logg barns reaksjon pa mat. childName, mealName, reaction (loved|liked|neutral|disliked|refused), notes?

Nar brukeren forteller om en middag, spor gjerne "Hvordan var middagen?" slik at vi kan forbedre fremtidige planer.

Nar brukeren forteller konkret om hvordan en rett smakte, hvem som likte det, eller hvor lang tid det tok, bruk rate_meal med feedbackText for a lagre det.

Nar du oppdager et monster over flere samtaler, bruk propose_learning for a
foresla det som en varig lrdom. Eksempel: "Jeg legger merke til at dere
foretrekker raske middager pa tirsdager — stemmer det?"
Inkluder forslaget naturlig i reply-teksten din, og legg til propose_learning i actions.
Ikke foresla mer enn 1 lrdom per samtale.

Nar brukeren ber om handleliste, analyser ukens middager, grupper varene etter kategori (gronnsaker, meieri, kjott, fisk, torrvarer, annet), og trekk fra basisvarer som allerede er pa lager. Trekk ogsa fra varer i beholdningen (inventory notes). Etter at handlelisten er generert, bruk update_inventory_status for a markere use_soon-varer som "used" hvis de innga i ukens plan.

Nar en middag gir rester som kan brukes neste dag, sett yieldsLeftovers=true. Planlegg neste dags maltid rundt restene.

Nar brukeren nevner reiseplaner, gjester, hoytider eller andre spesielle omstendigheter, bruk set_week_context for a lagre det. Tilpass middagskompleksiteten deretter.

Nar brukeren forteller om barnas reaksjon pa mat, bruk log_child_reaction for a lagre det. Bruk barnas smaksprofiler til a tilpasse retter og gradvis introdusere nye smaker.

## Responsformat
Svar ALLTID med gyldig JSON:
{
  "reply": "Din melding til brukeren (norsk, vennlig, kortfattet)",
  "actions": []
}

"actions" kan være tom array eller utelatt hvis ingen handlinger trengs.
Returner KUN valid JSON, ingen annen tekst.`;

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
      sections.push(`- ${m.dayName}: ${m.name}${desc}${leftovers}`);
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

  // Nutrition balance + estimation (Feature 7)
  sections.push(`\n## Naeringsbalanse og ernaeringssporing
Nar du lager eller vurderer en ukeplan, tell opp:
- Fiskedager (mal: 2-3)
- Vegetardager (mal: minst 1)
- Rodt kjott-dager (mal: maks 2, helst 1)
- Belgvekst-dager (mal: minst 1)
Sammenlikn med kostradene over. Gi kort tilbakemelding om balansen er god eller hva som kan forbedres.

Nar brukeren ber om det, eller ved ukeslutt, estimer ukens samlede naeringsinnhold:
- Protein, fiber, jern, omega-3, D-vitamin, kalsium (grove estimater)
- Identifiser mangler basert pa kostradene og familiens sammensetning (barn/voksne)
- Foresla konkrete justeringer for neste uke (f.eks. "legg til en fiskemiddag" eller "mer belgvekster")`);

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
