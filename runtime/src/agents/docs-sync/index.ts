import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { callClaudeJson } from '../../lib/claude-json.js';

import {
  DocsSyncInputSchema,
  DocsSyncOutputSchema,
  type DocsSyncInput,
  type DocsSyncOutput,
  type SuggestedUpdate,
} from './schemas.js';

const SYSTEM_PROMPT = `Du er en dokumentasjonsassistent for FYRK, et norsk fintech-selskap.
Din oppgave er å analysere kodeendringer og sjekke om innholdssider (Astro-sider) trenger oppdatering.

Regler:
- Skriv på norsk
- Fokuser på brukervendte endringer som påvirker innholdssider
- Ignorer rene kodeendringer som ikke påvirker innhold (styling, interne refaktoreringer)
- Behold eksisterende formattering og struktur i sidene
- Gjør kun endringer som er nødvendige — ikke skriv om hele sider
- Behold alle Astro frontmatter og komponentimporter uendret med mindre de er direkte relevante

Returner et JSON-objekt med nøyaktig denne strukturen:
{
  "hasUpdates": true/false,
  "summary": "Kort oppsummering av hva som bør oppdateres",
  "suggestedUpdates": [
    {
      "path": "sti/til/side.astro",
      "originalContent": "hele det originale innholdet i filen",
      "updatedContent": "hele det oppdaterte innholdet i filen",
      "reason": "Forklaring på hvorfor siden bør oppdateres"
    }
  ],
  "prTitle": "Kort PR-tittel (maks 70 tegn)",
  "prBody": "PR-beskrivelse i markdown"
}

Hvis ingen sider trenger oppdatering, returner hasUpdates: false med tom suggestedUpdates-array.
Returner KUN valid JSON, ingen annen tekst.`;

function buildUserPrompt(input: DocsSyncInput): string {
  const lines: string[] = [];

  lines.push('## Kodeendringer\n');
  lines.push(`Repository: ${input.repo}`);
  lines.push(`Commits: ${input.commitMessages.join('; ')}\n`);

  lines.push('### Endrede filer\n');
  for (const file of input.changedFiles) {
    lines.push(`**${file.path}** (${file.status}):`);
    lines.push('```diff');
    lines.push(file.diff);
    lines.push('```\n');
  }

  lines.push('## Innholdssider å vurdere\n');
  for (const page of input.contentPages) {
    lines.push(`### ${page.path}\n`);
    lines.push('```astro');
    lines.push(page.content);
    lines.push('```\n');
  }

  lines.push('Analyser kodeendringene og sjekk om noen av innholdssidene trenger oppdatering.');

  return lines.join('\n');
}

async function execute(
  input: DocsSyncInput,
  _ctx: AgentContext,
): Promise<AgentResult<DocsSyncOutput>> {
  const userPrompt = buildUserPrompt(input);

  const { parsed: output } = await callClaudeJson(DocsSyncOutputSchema, {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Filter out updates where content didn't actually change
  const realUpdates: SuggestedUpdate[] = output.suggestedUpdates.filter(
    (u) => u.originalContent !== u.updatedContent,
  );

  const finalOutput: DocsSyncOutput = {
    ...output,
    hasUpdates: realUpdates.length > 0,
    suggestedUpdates: realUpdates,
  };

  return {
    output: finalOutput,
    artifacts: finalOutput.hasUpdates
      ? [
          {
            kind: 'docs-sync-report',
            content: JSON.stringify(finalOutput, null, 2),
            meta: {
              repo: input.repo,
              beforeSha: input.beforeSha,
              afterSha: input.afterSha,
              pagesAnalyzed: input.contentPages.length,
              updatesFound: realUpdates.length,
            },
          },
        ]
      : [],
  };
}

export const docsSyncAgent: AgentDefinition<DocsSyncInput, DocsSyncOutput> = {
  name: 'docs-sync',
  version: '0.1',
  inputSchema: DocsSyncInputSchema,
  outputSchema: DocsSyncOutputSchema,
  execute,
};
