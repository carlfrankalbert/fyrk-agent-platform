import { createClient } from '@supabase/supabase-js';
import type { AgentRun, Artifact } from '../lib/schemas.js';

export interface DbClient {
  createRun(run: Omit<AgentRun, 'id' | 'created_at' | 'finished_at'>): Promise<AgentRun>;
  updateRun(id: string, updates: Partial<AgentRun>): Promise<AgentRun>;
  createArtifact(artifact: Omit<Artifact, 'id' | 'created_at'>): Promise<Artifact>;
  getArtifactsByRunId(runId: string): Promise<Artifact[]>;
}

export class SupabaseDbClient implements DbClient {
  private client;

  constructor(url: string, key: string) {
    this.client = createClient(url, key);
  }

  async createRun(run: Omit<AgentRun, 'id' | 'created_at' | 'finished_at'>): Promise<AgentRun> {
    const result = await this.client
      .from('agent_runs')
      .insert(run)
      .select()
      .single();

    if (result.error) throw new Error(`Failed to create run: ${result.error.message}`);
    return result.data as AgentRun;
  }

  async updateRun(id: string, updates: Partial<AgentRun>): Promise<AgentRun> {
    const result = await this.client
      .from('agent_runs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (result.error) throw new Error(`Failed to update run: ${result.error.message}`);
    return result.data as AgentRun;
  }

  async createArtifact(artifact: Omit<Artifact, 'id' | 'created_at'>): Promise<Artifact> {
    const result = await this.client
      .from('artifacts')
      .insert(artifact)
      .select()
      .single();

    if (result.error) throw new Error(`Failed to create artifact: ${result.error.message}`);
    return result.data as Artifact;
  }

  async getArtifactsByRunId(runId: string): Promise<Artifact[]> {
    const result = await this.client
      .from('artifacts')
      .select()
      .eq('run_id', runId);

    if (result.error) throw new Error(`Failed to get artifacts: ${result.error.message}`);
    return result.data as Artifact[];
  }
}

// Null client for dry runs
export class NullDbClient implements DbClient {
  private runCounter = 0;
  private artifactCounter = 0;

  createRun(run: Omit<AgentRun, 'id' | 'created_at' | 'finished_at'>): Promise<AgentRun> {
    return Promise.resolve({
      ...run,
      id: `dry-run-${++this.runCounter}`,
      created_at: new Date().toISOString(),
      finished_at: null,
    });
  }

  updateRun(id: string, updates: Partial<AgentRun>): Promise<AgentRun> {
    return Promise.resolve({
      id,
      agent_name: 'unknown',
      agent_version: '0.1',
      status: 'completed',
      input: {},
      output: {},
      error: null,
      created_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      ...updates,
    } as AgentRun);
  }

  createArtifact(artifact: Omit<Artifact, 'id' | 'created_at'>): Promise<Artifact> {
    return Promise.resolve({
      ...artifact,
      id: `dry-artifact-${++this.artifactCounter}`,
      created_at: new Date().toISOString(),
    });
  }

  getArtifactsByRunId(_runId: string): Promise<Artifact[]> {
    return Promise.resolve([]);
  }
}
