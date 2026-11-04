import type { SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'slack_bot_event_dedup';
const RETENTION_MS = 60 * 60_000;
const CLEANUP_INTERVAL_MS = 10 * 60_000;

/**
 * Atomically claim a Slack event_id (INSERT ... ON CONFLICT DO NOTHING).
 * Returns true if this process claimed it, false if it was already claimed (by another machine or an earlier delivery).
 * Throws on database errors so the caller decides whether to fail open or closed.
 */
export async function claimEvent(supabase: SupabaseClient, eventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({ event_id: eventId }, { onConflict: 'event_id', ignoreDuplicates: true })
    .select('event_id');
  if (error) throw new Error(`Event dedup failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

let lastCleanup = 0;

/** Delete claims older than an hour, at most once per 10 minutes per process. */
export async function cleanupClaims(supabase: SupabaseClient, now = Date.now()): Promise<void> {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = new Date(now - RETENTION_MS).toISOString();
  const { error } = await supabase.from(TABLE).delete().lt('claimed_at', cutoff);
  if (error) throw new Error(`Event dedup cleanup failed: ${error.message}`);
}

/** Test hook */
export function resetCleanupThrottle(): void {
  lastCleanup = 0;
}
