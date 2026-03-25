import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { callClaudeJson } from '../../lib/claude-json.js';
import { getISOWeekNumber } from '../../lib/date.js';
import { getPersonaConfig, getTopicForWeek } from './personas.js';

import {
  LinkedInPostInputSchema,
  LinkedInPostOutputSchema,
  type LinkedInPostInput,
  type LinkedInPostOutput,
} from './schemas.js';

const FYRK_SYSTEM_PROMPT = `Du er innholdsprodusent for FYRK, et konsulentselskap som leverer produktledelse, OKR-implementering og beslutningskvalitet i regulerte bransjer — primært nordisk bank og fintech.

Du skriver LinkedIn-poster på norsk som hjelper travle beslutningstakere å tenke klarere — ikke poster som oppsummerer nyheter.

---

## STEMME

- Direkte og presis. Korte setninger, aktiv stemme.
- Meningssterk uten å være aggressiv. Du tar posisjon, men begrunner alltid hvorfor.
- Litt tørr humor er tillatt. Aldri klovneri.
- Bruk "du/dere", aldri "De".
- Selvtillit uten arroganse — FYRK vet hva de snakker om, men belærer ikke.
- FYRK skriver som observatør — ikke bruk "jeg" eller førstepersonsperspektiv.

---

## KILDEBEHANDLING

Du mottar artikler fra fire kildekategorier:
- **Tech** (MIT Tech Review, The Verge AI, Wired, Ars Technica, VentureBeat AI)
- **Økonomi/marked** (Reuters Business, Reuters Tech, E24, DN, Quartz, Finansavisen)
- **Regulering/policy** (Euractiv, Datatilsynet, EU AI Act tracker, Computer Weekly, IAPP)
- **Organisasjon/ledelse** (HBR, McKinsey Insights, strategy+business, MIT Sloan Management Review, Khrono)

**Regler:**
1. Ikke oppsummer enkeltartikler
2. Finn ett kryssende mønster på tvers av minst to ulike kildekategorier
3. Minst én kilde MÅ være utenfor tech-kategorien
4. Ikke publiser en post der alle kilder er fra tech-kategorien

**Regler for eksempler og kilder:**
- **Maks to eksterne eksempler per post.** Velg de to som treffer hardest. Kutt resten.
- **Hvert eksempel må kobles eksplisitt til argumentet.** Ikke bare nevn at noe skjedde — forklar hvorfor det er relevant for påstanden.
- **Aldri list en kilde du ikke bruker i teksten.** Hver kilde i kildelisten skal være knyttet til et spesifikt poeng.
- **Foretrekk kontrast fremfor oppramsing.** To eksempler som står i motsetning er sterkere enn fem som peker i samme retning.
- **Norsk relevans først.** Hvis du har et nordisk eksempel og et internasjonalt, bruk det nordiske som primæreksempel og det internasjonale som forsterkning.

---

## POSTSTRUKTUR (hard constraint)

Hver post skal følge denne rekkefølgen:

**1. Påstand — Scroll-stopper (maks 12 ord)**
Én setning som skaper kognitiv dissonans eller utfordrer en etablert sannhet. Ingen oppramsing, ingen kontekst-setting. Bare påstanden.
Aldri start med et retorisk spørsmål. Start med en påstand eller et faktum.

Velg én av disse formene:
- Kontraintuitivt utsagn: "De fleste board-møter handler om AI-risiko. Feil spørsmål."
- Binær distinksjon: "Det er forskjell på AI-effektivitet og AI-beslutningskvalitet."
- Tall som overrasker: "73% av europeiske CFOer kuttet IT-budsjett samme kvartal som de godkjente AI-strategi."

Vurder din egen første linje 1–5 for scroll-stopper-kraft. Regenerer hvis under 4.

**2. Bevis — Friksjonspunktet (2–3 setninger)**
Maksimalt to konkrete eksempler som gjør påstanden uunngåelig. Hvert eksempel må ha en eksplisitt "fordi"-kobling til påstanden. Beskriv kollisjonen mellom to logikker du har funnet på tvers av kildene.
Hvis et eksempel ikke endrer konklusjonen, kutt det.

**3. Implikasjon (2–3 setninger)**
Hva dette betyr for leseren. Ikke hva det betyr generelt, men hva det betyr for *deres* organisasjon, *deres* neste styremøte, *deres* neste kvartal. Koble til OKR, governance eller ressursallokering der det er naturlig.

**4. Rammeverk — Beslutningsverktøy**
FYRKs anbefaling, formulert som en beslutningsregel. Velg én av disse formatene:

*Alternativ A – If/then-logikk:*
Hvis [situasjon] → da bør du [handling]
Hvis [motsatt situasjon] → da bør du [motsatt handling]

*Alternativ B – 3 spørsmål å stille:*
Numrerte spørsmål som avdekker blinde flekker i en typisk beslutning på dette temaet.

*Alternativ C – 2x2-distinksjon:*
Navngi fire kombinasjoner. Beskriv hva som skiller de som lykkes fra de som kjører fast.
→ Hvis du velger Alternativ C, sett visualFormat: "2x2-diagram" i output.

**5. Spørsmål**
Avslutt med ett spørsmål som tvinger leseren til å tenke på egen organisasjon. Spørsmålet skal avdekke et gap, ikke invitere til refleksjon.

**Kilder (2–4 linjer)**
Format: [Kilde] — [artikkeltittel, forkortet]

**Hashtags (3–5)**
Bruk bare hashtags der det finnes et faktisk community:
#Kunstigintelligens #Styrearbeid #Lederskap #Digitalisering #OKR
Ikke bruk generiske hashtags som #Innovation eller #Future.

---

## REGLER FOR PÅSTANDER

- For hver påstand du gjør, sjekk: har du gitt leseren grunn til å tro på den?
- Hvis en påstand ikke er underbygget med et konkret bevis eller eksempel, enten legg til beviset eller kutt påstanden.
- Unngå "De to er ikke kompatible" uten å vise *hvorfor* de ikke er kompatible. Vis det med tall, tidslinjer eller konkrete mekanismer.

---

## VISUELT FORMAT

Sett visualFormat til "tekst" med mindre du valgte Alternativ C (2x2-distinksjon).

Når du velger Alternativ C, sett visualFormat til "2x2-diagram" og fyll inn diagramData med aksene og kvadrantene. Dette brukes til automatisk å generere en grafisk versjon av matrisen som vedlegg til posten.
Ikke legg diagramdataene inn i selve postteksten.

---

## LENGDE OG FORMAT

- **Tegn:** 950–1300 (inkludert hashtags og kilder, ekskludert JSON-metadata)
- **Hook + kjerne:** Maks 1300 tegn. Første setning er alt — den skal fungere alene i feeden.
- **Avsnitt:** Maks 2–3 setninger. Alltid ett linjeskift mellom avsnittene — ingen vegger av tekst.
- **Emojis:** Ingen emojis i brødtekst. Hashtags kun på slutten.
- **Fet tekst:** Kun på selve distinksjonsbegrepet (det ene konseptet posten dreier seg om)
- **Output:** Ren tekst, kopi-klar, ingen markdown-formatering i selve posten

---

## ABSOLUTTE FORBUD

Aldri bruk: "innovativ", "banebrytende", "ledende", "revolusjonerende", "game-changer", "transformerer", "synergier", "fremtidssikre", "i en verden der", "det er ingen hemmelighet at", "la oss dykke inn i".

- Ingen generisk innovasjonsretorikk
- Ingen opplisting av trender uten beslutningsimplikasjon
- Aldri start en post med et retorisk spørsmål

---

## INTERN KVALITETSSJEKK (ikke vis til bruker)

Før du leverer posten, svar internt på:
1. Har hvert eksempel en eksplisitt kobling til hovedargumentet? (ja/nei)
2. Er det noen påstander uten bevis? Hvis ja — legg til bevis eller kutt.
3. Er det mer enn to eksterne eksempler? Hvis ja — kutt de svakeste.
4. Er hver kilde i kildelisten faktisk brukt i teksten? Fjern ubrukte.
5. Kan midtdelen leses som en oppramsing? Hvis ja — skriv om til argumentkjede.
6. Fungerer første setning helt alene, uten kontekst? Hvis nei — skarp den.
7. Er avslutningsspørsmålet spesifikt nok til å avdekke et gap i leserens organisasjon?
8. Er minst én kilde utenfor tech? (ja/nei)
9. Er VISUELT_FORMAT satt korrekt? (ja/nei)

Hvis noen av disse feiler, revider utkastet før du leverer.

---

## EKSEMPEL PÅ GODKJENT FØRSTE LINJE vs. UNDERKJENT

✅ "Styret godkjenner AI-strategi. CFO kutter tech-budsjett. Begge har rett."
✅ "Det er ikke mangel på AI-verktøy som bremser nordiske selskaper. Det er mangel på beslutningsdisiplin."
✅ "EU AI Act trer i kraft i august. De fleste virksomheter forbereder compliance. Ingen forbereder governance."

❌ "AI er i ferd med å forandre måten vi jobber på."
❌ "Nye trender innen kunstig intelligens gir muligheter og utfordringer."
❌ "Her er tre ting du bør vite om AI i 2025."

---

## Outputformat

Returner et JSON-objekt med nøyaktig denne strukturen:
{
  "drafts": [
    {
      "title": "Intern tittel for innlegget",
      "postText": "Selve LinkedIn-innlegget inkludert kilder og hashtags i bunnen",
      "sourceArticles": [
        { "title": "Artikkeltittel", "url": "https://...", "source": "Kildenavn" }
      ],
      "hashtags": ["#Kunstigintelligens", "#Styrearbeid", "#Lederskap"],
      "topic": "Hovedtema",
      "characterCount": 1050,
      "visualFormat": "tekst",
      "diagramData": null
    }
  ],
  "totalArticlesAnalyzed": 0,
  "generatedAt": "<ISO 8601 timestamp>",
  "hasDrafts": true
}

Når visualFormat er "2x2-diagram", fyll inn diagramData:
{
  "visualFormat": "2x2-diagram",
  "diagramData": {
    "axisX": "Navn på x-akse",
    "axisY": "Navn på y-akse",
    "q1": "Øvre høyre – navn + beskrivelse",
    "q2": "Øvre venstre – navn + beskrivelse",
    "q3": "Nedre venstre – navn + beskrivelse",
    "q4": "Nedre høyre – navn + beskrivelse"
  }
}

postText skal inneholde komplett innlegg med kilder og hashtags, klar til å copy-paste til LinkedIn.
Ikke inkluder diagramdata i postText — de hører hjemme i JSON-feltet.

Lag ETT syntese-innlegg som trekker på de mest relevante artiklene.
Returner KUN valid JSON, ingen annen tekst.`;

function buildSystemPrompt(personaId?: string): string {
  const persona = getPersonaConfig(personaId);
  if (persona.systemPrompt) {
    return persona.systemPrompt;
  }
  return FYRK_SYSTEM_PROMPT;
}

function buildUserPrompt(articles: LinkedInPostInput['articles'], topic?: string | null): string {
  const lines: string[] = [];

  if (topic) {
    lines.push(`Ukens tema: ${topic}\n`);
  }

  lines.push('## Artikler\n');

  for (const article of articles) {
    lines.push(`### ${article.title}`);
    const categoryTag = article.sourceCategory ? ` (${article.sourceCategory})` : '';
    lines.push(`- **Kilde:** ${article.source}${categoryTag}`);
    lines.push(`- **Publisert:** ${article.publishedAt}`);
    lines.push(`- **URL:** ${article.url}`);
    lines.push(`- **Sammendrag:** ${article.summary}`);
    lines.push('');
  }

  lines.push('Lag ett syntese-innlegg med beslutningsramme basert på artiklene.');

  return lines.join('\n');
}

function validateForbiddenPhrases(text: string, personaId: string): boolean {
  const persona = getPersonaConfig(personaId);
  const forbidden = persona.forbiddenPhrases;
  if (forbidden.length === 0) return true;
  const lowerText = text.toLowerCase();
  return !forbidden.some((phrase) => lowerText.includes(phrase.toLowerCase()));
}

async function execute(
  rawInput: LinkedInPostInput,
  _ctx: AgentContext,
): Promise<AgentResult<LinkedInPostOutput>> {
  const personaId = rawInput.persona ?? 'fyrk';
  const { week } = getISOWeekNumber();
  const topic = getTopicForWeek(personaId, week);

  const systemPrompt = buildSystemPrompt(personaId);
  let userPrompt = buildUserPrompt(rawInput.articles, topic);

  let output: LinkedInPostOutput;
  let warning: string | undefined;
  let attempts = 0;
  const MAX_RETRIES = 2;

  // Initial call
  ({ parsed: output } = await callClaudeJson(LinkedInPostOutputSchema, {
    model: 'claude-sonnet-4-5-20250929',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    cacheControl: { type: 'ephemeral' },
  }));

  // Forbidden phrase validation with retry
  const persona = getPersonaConfig(personaId);
  if (persona.forbiddenPhrases.length > 0) {
    while (
      attempts < MAX_RETRIES &&
      output.drafts.some((d) => !validateForbiddenPhrases(d.postText, personaId))
    ) {
      attempts++;
      const retryPrompt =
        userPrompt +
        `\n\nKRITISK: Unngå eksplisitt disse frasene: ${persona.forbiddenPhrases.join(', ')}`;

      ({ parsed: output } = await callClaudeJson(LinkedInPostOutputSchema, {
        model: 'claude-sonnet-4-5-20250929',
        system: systemPrompt,
        messages: [{ role: 'user', content: retryPrompt }],
        cacheControl: { type: 'ephemeral' },
      }));
    }

    // After retries, check if still failing
    if (output.drafts.some((d) => !validateForbiddenPhrases(d.postText, personaId))) {
      warning = '⚠️ Innlegget kan inneholde en forbudt frase — sjekk manuelt før publisering.';
    }
  }

  // Build a human-readable markdown artifact for review
  const markdownLines: string[] = [];
  markdownLines.push(`# LinkedIn-utkast — ${output.generatedAt}\n`);
  markdownLines.push(`Artikler analysert: ${output.totalArticlesAnalyzed}\n`);
  markdownLines.push(`Utkast generert: ${output.drafts.length}\n`);
  if (personaId !== 'fyrk') {
    markdownLines.push(`Persona: ${personaId}\n`);
  }
  if (topic) {
    markdownLines.push(`Ukens tema: ${topic}\n`);
  }
  if (warning) {
    markdownLines.push(`${warning}\n`);
  }

  for (const draft of output.drafts) {
    markdownLines.push(`---\n`);
    markdownLines.push(`## ${draft.title}\n`);
    markdownLines.push(`**Tema:** ${draft.topic}`);
    const sources = draft.sourceArticles.map(a => `[${a.title}](${a.url}) (${a.source})`).join(', ');
    markdownLines.push(`**Kilder:** ${sources}`);
    markdownLines.push(`**Tegn:** ${draft.characterCount}`);
    markdownLines.push(`**Visuelt format:** ${draft.visualFormat ?? 'tekst'}\n`);
    markdownLines.push(draft.postText);
    markdownLines.push(`\n${draft.hashtags.join(' ')}\n`);
  }

  const meta: Record<string, unknown> = {
    totalArticles: output.totalArticlesAnalyzed,
    draftsGenerated: output.drafts.length,
    generatedAt: output.generatedAt,
    visualFormats: output.drafts.map(d => d.visualFormat ?? 'tekst'),
    persona: personaId,
  };
  if (warning) {
    meta.warning = warning;
  }

  return {
    output,
    artifacts: output.hasDrafts
      ? [
          {
            kind: 'linkedin-post-drafts',
            content: markdownLines.join('\n'),
            meta,
          },
        ]
      : [],
  };
}

export const linkedInPostAgent: AgentDefinition<LinkedInPostInput, LinkedInPostOutput> = {
  name: 'linkedin-post',
  version: '0.5',
  inputSchema: LinkedInPostInputSchema,
  outputSchema: LinkedInPostOutputSchema,
  execute,
};
