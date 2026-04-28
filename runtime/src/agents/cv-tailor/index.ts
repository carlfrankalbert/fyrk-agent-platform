import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { callClaudeJson } from '../../lib/claude-json.js';
import { buildSystemPrompt, buildUserPrompt, buildEditorialSystemPrompt, buildEditorialUserPrompt } from './prompt.js';

import {
  CvTailorInputSchema,
  CvTailorOutputSchema,
  EditorialPassSchema,
  type CvTailorInput,
  type CvTailorOutput,
} from './schemas.js';

async function execute(
  rawInput: CvTailorInput,
  _ctx: AgentContext,
): Promise<AgentResult<CvTailorOutput>> {
  const language = rawInput.language ?? 'no';
  const roleHint = rawInput.roleHint ?? null;

  const systemPrompt = buildSystemPrompt(language);
  const userPrompt = buildUserPrompt(rawInput.jobPosting, roleHint, rawInput.additionalContext);

  const { parsed: output } = await callClaudeJson(CvTailorOutputSchema, {
    model: 'claude-sonnet-4-5-20250929',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 8192,
    cacheControl: { type: 'ephemeral' },
  });

  // Editorial pass — Haiku polishes language without changing facts
  const editorialInput = {
    profile: output.cv.profile,
    coreCompetencies: output.cv.coreCompetencies,
    experience: output.cv.experience.map(e => ({ description: e.description, highlights: e.highlights })),
  };

  const { parsed: editorial } = await callClaudeJson(EditorialPassSchema, {
    model: 'claude-haiku-4-5-20251001',
    system: buildEditorialSystemPrompt(language),
    messages: [{ role: 'user', content: buildEditorialUserPrompt(editorialInput) }],
    maxTokens: 4096,
  });

  // Merge polished text back into output
  output.cv.profile = editorial.profile;
  output.cv.coreCompetencies = editorial.coreCompetencies;
  for (let i = 0; i < output.cv.experience.length; i++) {
    if (editorial.experience[i]) {
      output.cv.experience[i].description = editorial.experience[i].description;
      output.cv.experience[i].highlights = editorial.experience[i].highlights;
    }
  }

  // Build markdown artifact for human review
  const md: string[] = [];
  const cv = output.cv;

  md.push(`# ${cv.name}`);
  md.push(`**${cv.title}**`);
  md.push(`${cv.contact}\n`);
  md.push(`${cv.profile}\n`);

  md.push('## Kjernekompetanse\n');
  for (const comp of cv.coreCompetencies) {
    md.push(`- ${comp}`);
  }

  md.push('\n## Erfaring\n');
  for (const exp of cv.experience) {
    md.push(`### ${exp.company} | ${exp.role}`);
    md.push(`*${exp.period}*\n`);
    md.push(`${exp.description}\n`);
    for (const h of exp.highlights) {
      md.push(`- ${h}`);
    }
    md.push('');
  }

  if (cv.education.length > 0) {
    md.push('## Utdanning\n');
    for (const edu of cv.education) {
      md.push(`- ${edu}`);
    }
    md.push('');
  }

  if (cv.certifications.length > 0) {
    md.push('## Sertifiseringer\n');
    for (const cert of cv.certifications) {
      md.push(`- ${cert}`);
    }
    md.push('');
  }

  if (cv.talks.length > 0) {
    md.push('## Foredrag\n');
    for (const talk of cv.talks) {
      md.push(`- ${talk}`);
    }
    md.push('');
  }

  if (cv.languages.length > 0) {
    md.push('## Språk\n');
    md.push(cv.languages.join(' | '));
    md.push('');
  }

  // Match analysis and gap analysis are kept in JSON output only (output.matchAnalysis, output.gaps)
  // but NOT included in the markdown artifact — the CV should be clean and ready to use

  return {
    output,
    artifacts: [
      {
        kind: 'cv-tailor-output',
        content: md.join('\n'),
        meta: {
          roleHint,
          fitScore: output.matchAnalysis.fitScore,
          overallFit: output.matchAnalysis.overallFit,
          gapQuestions: output.gaps.questions.length,
          generatedAt: output.generatedAt,
        },
      },
    ],
  };
}

export const cvTailorAgent: AgentDefinition<CvTailorInput, CvTailorOutput> = {
  name: 'cv-tailor',
  version: '0.1',
  inputSchema: CvTailorInputSchema,
  outputSchema: CvTailorOutputSchema,
  execute,
};
