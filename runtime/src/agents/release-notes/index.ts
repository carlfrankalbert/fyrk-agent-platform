import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import {
  ReleaseNotesInputSchema,
  ReleaseNotesOutputSchema,
  type ReleaseNotesInput,
  type ReleaseNotesOutput,
  type Commit,
  type CategorizedCommit,
  type ChangeCategory,
} from './schemas.js';

const RISK_KEYWORDS = ['breaking', 'migration', 'security', 'pii', 'auth', 'db', 'payment'];

const CATEGORY_PREFIXES: Record<string, ChangeCategory> = {
  feat: 'features',
  fix: 'fixes',
  chore: 'chores',
  docs: 'chores',
  refactor: 'chores',
  test: 'chores',
  style: 'chores',
  perf: 'features',
  ci: 'chores',
  build: 'chores',
};

function categorizeCommit(commit: Commit): CategorizedCommit {
  const message = commit.message.toLowerCase();

  // Detect category from conventional commit prefix
  let category: ChangeCategory = 'chores';
  for (const [prefix, cat] of Object.entries(CATEGORY_PREFIXES)) {
    if (message.startsWith(`${prefix}:`) || message.startsWith(`${prefix}(`)) {
      category = cat;
      break;
    }
  }

  // Detect risk keywords
  const riskKeywords = RISK_KEYWORDS.filter((kw) => message.includes(kw));

  // Determine if highlight (features and fixes with significant changes)
  const isHighlight = category === 'features' || (category === 'fixes' && riskKeywords.length > 0);

  return {
    sha: commit.sha,
    message: commit.message,
    author: commit.author,
    url: commit.url,
    category,
    isHighlight,
    riskKeywords,
  };
}

function generateHighlights(commits: CategorizedCommit[]): string[] {
  return commits
    .filter((c) => c.isHighlight)
    .slice(0, 5)
    .map((c) => {
      // Extract clean message without prefix
      const cleanMessage = c.message.replace(/^(feat|fix|chore|docs|refactor|test)(\([^)]+\))?:\s*/i, '');
      return cleanMessage.charAt(0).toUpperCase() + cleanMessage.slice(1);
    });
}

function generateRiskNotes(commits: CategorizedCommit[]): string[] {
  const risks: string[] = [];

  for (const commit of commits) {
    if (commit.riskKeywords.length > 0) {
      const keywords = commit.riskKeywords.join(', ');
      risks.push(`⚠️ ${commit.message} (keywords: ${keywords})`);
    }
  }

  return risks;
}

function generateMarkdown(
  repo: string,
  rangeLabel: string,
  output: ReleaseNotesOutput
): string {
  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push(`# ${output.title}`);
  lines.push('');
  lines.push(`**Repository:** ${repo}`);
  lines.push(`**Range:** ${rangeLabel}`);
  lines.push(`**Date:** ${date}`);
  lines.push('');

  if (output.highlights.length > 0) {
    lines.push('## Highlights');
    lines.push('');
    for (const highlight of output.highlights) {
      lines.push(`- ${highlight}`);
    }
    lines.push('');
  }

  if (output.changes.features.length > 0) {
    lines.push('## Features');
    lines.push('');
    for (const commit of output.changes.features) {
      lines.push(`- ${commit.message} ([${commit.sha.slice(0, 7)}](${commit.url})) - @${commit.author}`);
    }
    lines.push('');
  }

  if (output.changes.fixes.length > 0) {
    lines.push('## Fixes');
    lines.push('');
    for (const commit of output.changes.fixes) {
      lines.push(`- ${commit.message} ([${commit.sha.slice(0, 7)}](${commit.url})) - @${commit.author}`);
    }
    lines.push('');
  }

  if (output.changes.chores.length > 0) {
    lines.push('## Chores');
    lines.push('');
    for (const commit of output.changes.chores) {
      lines.push(`- ${commit.message} ([${commit.sha.slice(0, 7)}](${commit.url})) - @${commit.author}`);
    }
    lines.push('');
  }

  if (output.riskNotes.length > 0) {
    lines.push('## Risk Notes');
    lines.push('');
    for (const note of output.riskNotes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function execute(
  input: ReleaseNotesInput,
  _ctx: AgentContext
): Promise<AgentResult<ReleaseNotesOutput>> {
  if (input.mode === 'github') {
    return Promise.reject(new Error('github mode not implemented yet'));
  }

  // Fixture mode - process provided commits
  const categorized = input.commits.map(categorizeCommit);

  const changes = {
    features: categorized.filter((c) => c.category === 'features'),
    fixes: categorized.filter((c) => c.category === 'fixes'),
    chores: categorized.filter((c) => c.category === 'chores'),
  };

  const output: ReleaseNotesOutput = {
    title: `Release Notes: ${input.rangeLabel}`,
    highlights: generateHighlights(categorized),
    changes,
    riskNotes: generateRiskNotes(categorized),
  };

  const markdown = generateMarkdown(input.repo, input.rangeLabel, output);

  return Promise.resolve({
    output,
    artifacts: [
      {
        kind: 'markdown',
        content: markdown,
        meta: {
          repo: input.repo,
          rangeLabel: input.rangeLabel,
        },
      },
    ],
  });
}

export const releaseNotesAgent: AgentDefinition<ReleaseNotesInput, ReleaseNotesOutput> = {
  name: 'release-notes',
  version: '0.1',
  inputSchema: ReleaseNotesInputSchema,
  outputSchema: ReleaseNotesOutputSchema,
  execute,
};
