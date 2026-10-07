import { createClient } from '@supabase/supabase-js';
import { AssignmentSchema, ScoreSchema, type StoredAssignment } from './schemas.js';

export interface RadarStore {
  acquire(token: string): Promise<boolean>;
  release(token: string): Promise<void>;
  list(): Promise<StoredAssignment[]>;
  /** Persists the record; queueDelivery adds a pending delivery unless one already exists in any state. */
  save(token: string, record: StoredAssignment, queueDelivery: boolean): Promise<void>;
  pending(): Promise<string[]>;
  claim(token: string, id: string): Promise<boolean>;
  finish(id: string, status: 'sent' | 'pending' | 'uncertain', channel?: string, ts?: string, error?: string): Promise<void>;
}
export class SupabaseRadarStore implements RadarStore {
  private client;
  constructor(url: string, key: string) { this.client = createClient(url, key); }
  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.client.rpc(name, args);
    const data: unknown = result.data;
    const error = result.error;
    if (error) throw new Error(`Radar database ${name}: ${error.message}`);
    return data as T;
  }
  acquire(token: string): Promise<boolean> { return this.rpc('assignment_radar_acquire', { p_token: token }); }
  release(token: string): Promise<void> { return this.rpc('assignment_radar_release', { p_token: token }); }
  async list(): Promise<StoredAssignment[]> {
    const result: StoredAssignment[] = [];
    // Read all candidates and observations, avoiding Supabase's default 1000-row truncation.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client.from('assignment_radar_assignments')
        .select('id,assignment,score,assignment_radar_observations(*)').order('id').range(offset, offset + 499);
      if (error) throw new Error(`Radar read: ${error.message}`);
      for (const row of data) result.push({ id: row.id as string, assignment: AssignmentSchema.parse(row.assignment),
        score: ScoreSchema.parse(row.score), observations: AssignmentSchema.array().parse(row.assignment_radar_observations) });
      if (data.length < 500) return result;
    }
  }
  save(token: string, record: StoredAssignment, queueDelivery: boolean): Promise<void> {
    // The RPC inserts a delivery only when both flags are set, with ON CONFLICT DO NOTHING: an existing
    // pending/sending/sent/uncertain delivery is never recreated or reset.
    return this.rpc('assignment_radar_save', { p_token: token, p_record: record, p_new: queueDelivery, p_notify: queueDelivery });
  }
  async pending(): Promise<string[]> {
    const ids: string[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client.from('assignment_radar_deliveries').select('assignment_id')
        .eq('status', 'pending').order('assignment_id').range(offset, offset + 499);
      if (error) throw new Error(`Radar outbox: ${error.message}`);
      ids.push(...data.map(row => row.assignment_id as string));
      if (data.length < 500) return ids;
    }
  }
  claim(token: string, id: string): Promise<boolean> { return this.rpc('assignment_radar_claim', { p_token: token, p_id: id }); }
  async finish(id: string, status: 'sent' | 'pending' | 'uncertain', channel?: string, ts?: string, error?: string): Promise<void> {
    const result = await this.client.from('assignment_radar_deliveries').update({ status, slack_channel: channel,
      slack_ts: ts, error, updated_at: new Date().toISOString() }).eq('assignment_id', id).eq('status', 'sending');
    if (result.error) throw new Error(`Radar delivery state: ${result.error.message}`);
  }
}
