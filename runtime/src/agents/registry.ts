import type { AgentDefinition } from './base.js';
import { releaseNotesAgent } from './release-notes/index.js';

// Agent registry - add new agents here
const agents: Map<string, AgentDefinition<unknown, unknown>> = new Map();

// Register built-in agents
agents.set('release-notes', releaseNotesAgent as AgentDefinition<unknown, unknown>);

export function getAgent(name: string): AgentDefinition<unknown, unknown> | undefined {
  return agents.get(name);
}

export function listAgents(): string[] {
  return Array.from(agents.keys());
}
