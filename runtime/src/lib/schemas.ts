import { z } from 'zod';

// Base run request schema
export const RunRequestSchema = z.object({
  version: z.string().default('0.1'),
  input: z.record(z.unknown()).default({}),
  dryRun: z.boolean().default(false),
});

export type RunRequest = z.infer<typeof RunRequestSchema>;

// Base run response schema
export const RunResponseSchema = z.object({
  runId: z.string().uuid(),
  agentName: z.string(),
  agentVersion: z.string(),
  status: z.enum(['ok', 'error']),
  artifactIds: z.array(z.string().uuid()),
  output: z.record(z.unknown()),
  error: z.string().optional(),
});

export type RunResponse = z.infer<typeof RunResponseSchema>;

// Agent run record
export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  agent_name: z.string(),
  agent_version: z.string(),
  status: z.enum(['started', 'completed', 'failed']),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()),
  error: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});

export type AgentRun = z.infer<typeof AgentRunSchema>;

// Artifact record
export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  kind: z.string(),
  content: z.string(),
  meta: z.record(z.unknown()),
  created_at: z.string(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;
