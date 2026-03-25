import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { callClaudeJson } from '../../lib/claude-json.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';

import {
  CvTailorInputSchema,
  CvTailorOutputSchema,
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

  // Match analysis section
  md.push('---\n');
  md.push('# Treffanalyse\n');
  md.push(`**Overordnet match:** ${output.matchAnalysis.overallFit} (${output.matchAnalysis.fitScore}/100)\n`);
  md.push(`${output.matchAnalysis.strengthNarrative}\n`);

  md.push('**Matchede kompetanser:**');
  for (const skill of output.matchAnalysis.matchedSkills) {
    md.push(`- ${skill}`);
  }
  md.push('');

  md.push('**Matchede erfaringer:**');
  for (const exp of output.matchAnalysis.matchedExperience) {
    md.push(`- ${exp}`);
  }
  md.push('');

  // Gap analysis section
  if (output.gaps.questions.length > 0 || output.gaps.missingSkills.length > 0) {
    md.push('---\n');
    md.push('# Gap-analyse\n');

    if (output.gaps.missingSkills.length > 0) {
      md.push('**Manglende kompetanser:**');
      for (const skill of output.gaps.missingSkills) {
        md.push(`- ${skill}`);
      }
      md.push('');
    }

    if (output.gaps.missingExperience.length > 0) {
      md.push('**Manglende erfaring:**');
      for (const exp of output.gaps.missingExperience) {
        md.push(`- ${exp}`);
      }
      md.push('');
    }

    if (output.gaps.questions.length > 0) {
      md.push('**Spørsmål til Carl:**');
      for (const q of output.gaps.questions) {
        md.push(`- ${q}`);
      }
      md.push('');
    }

    if (output.gaps.suggestions.length > 0) {
      md.push('**Forslag til vinkling:**');
      for (const s of output.gaps.suggestions) {
        md.push(`- ${s}`);
      }
      md.push('');
    }
  }

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
