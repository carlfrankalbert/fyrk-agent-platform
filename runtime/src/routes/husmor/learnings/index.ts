export { extractLearnings, loadLearnings, buildLearningsSection } from './extraction.js';
export type { Learning } from './extraction.js';
export { computeMealPatterns, recencyWeight, buildPatternsSection, detectContradictions, buildContradictionsSection } from './patterns.js';
export type { MealPattern, Contradiction } from './patterns.js';
export { computeSuggestionMetrics, buildSuggestionMetricsSection, computeRejectionPatterns, buildRejectionPatternsSection } from './metrics.js';
export type { SuggestionMetrics, RejectionPattern } from './metrics.js';
export { loadReactionSummary, buildReactionSummarySection, detectKnowledgeGaps, buildKnowledgeGapsSection } from './signals.js';
export type { ReactionSummary, KnowledgeGap } from './signals.js';
