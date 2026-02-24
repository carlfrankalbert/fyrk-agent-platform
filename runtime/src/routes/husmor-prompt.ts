import { stripJsonFences } from '../lib/json.js';
import type { ClaudeMessage } from '../lib/claude.js';
import {
  HusmorClaudeResponseSchema,
  type HusmorClaudeResponse,
} from './husmor-schemas.js';
import type { DbContext } from './husmor-db.js';
import { buildLearningsSection, buildPatternsSection } from './husmor-learnings.js';

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
- add_meals: Legg til maltider. meals: [{ dayOfWeek (1=mandag), name, description?, mealType? }]
- update_meal: Oppdater et maltid. dayOfWeek, name, description?
- remove_meal: Fjern et maltid. dayOfWeek
- set_preference: Sett en preferanse. key, value
- add_inventory_note: Legg til beholdningsnotat. itemName, status? (available|use_soon), quantity?
- rate_meal: Gi tilbakemelding pa et maltid. dayOfWeek, feedbackEmoji?, rating? (1-5), feedbackText? (kort fritekst om smak/tid/barnevennlighet)
- generate_shopping_list: Generer handleliste. items: [{ name, amount?, unit?, category? }]
- update_plan_status: Oppdater planstatus. status (draft|proposed|approved|active|completed)
- propose_learning: Foresla en observasjon for bekreftelse. category, insight, confidence?
- save_recipe: Lagre en oppskrift. name, description?, prepTimeMin?, cookTimeMin?, servings?, ingredients? [{ name, amount?, unit? }], steps? [{ instruction, durationMin? }], linkToDayOfWeek?

Nar brukeren forteller om en middag, spor gjerne "Hvordan var middagen?" slik at vi kan forbedre fremtidige planer.

Nar brukeren forteller konkret om hvordan en rett smakte, hvem som likte det, eller hvor lang tid det tok, bruk rate_meal med feedbackText for a lagre det.

Nar du oppdager et monster over flere samtaler, bruk propose_learning for a
foresla det som en varig lrdom. Eksempel: "Jeg legger merke til at dere
foretrekker raske middager pa tirsdager — stemmer det?"
Inkluder forslaget naturlig i reply-teksten din, og legg til propose_learning i actions.
Ikke foresla mer enn 1 lrdom per samtale.

Nar brukeren ber om handleliste, analyser ukens middager, grupper varene etter kategori (gronnsaker, meieri, kjott, fisk, torrvarer, annet), og trekk fra basisvarer som allerede er pa lager.

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
      sections.push(`- ${m.dayName}: ${m.name}${desc}`);
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
  }

  // Meal patterns
  const patternsSection = buildPatternsSection(ctx.mealPatterns);
  if (patternsSection) {
    sections.push(`\n${patternsSection}`);
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

  // Nutrition balance instruction
  sections.push(`\n## Naeringsbalanse
Nar du lager eller vurderer en ukeplan, tell opp:
- Fiskedager (mal: 2-3)
- Vegetardager (mal: minst 1)
- Rodt kjott-dager (mal: maks 2, helst 1)
- Belgvekst-dager (mal: minst 1)
Sammenlikn med kostradene over. Gi kort tilbakemelding om balansen er god eller hva som kan forbedres.`);

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

  // Recipe instruction
  sections.push(`\n## Oppskrifter
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
    // Claude sometimes responds in plain text despite JSON instructions.
    // Salvage the text as a reply with no actions.
    return { reply: text.trim(), actions: [] };
  }
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
