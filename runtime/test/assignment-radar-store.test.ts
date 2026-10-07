import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal stand-in for the deliveries table behind supabase-js. Update payloads go through JSON like the real
// client, so undefined fields are dropped exactly as in production; .eq() filters select the rows to change.
interface Row { assignment_id: string; status: string; slack_channel: string | null; slack_ts: string | null; error: string | null; updated_at: string }
const table = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, payloads: [] as Array<Record<string, unknown>> }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (name: string) => {
      if (name !== 'assignment_radar_deliveries') throw new Error(`unexpected table ${name}`);
      return {
        update(payload: Record<string, unknown>) {
          const body = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
          table.payloads.push(body);
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq(col: string, val: unknown) { filters.push([col, val]); return builder; },
            then(resolve: (r: { error: null }) => void) {
              for (const row of table.rows) if (filters.every(([c, v]) => row[c] === v)) Object.assign(row, body);
              resolve({ error: null });
            },
          };
          return builder;
        },
      };
    },
  })),
}));

import { SupabaseRadarStore } from '../src/agents/assignment-radar/store.js';

const store = new SupabaseRadarStore('https://fake.supabase.co', 'service-key');
const row = (id: string): Row => table.rows.find(r => r.assignment_id === id) as unknown as Row;
const seed = (r: Partial<Row> & { assignment_id: string }): void => {
  table.rows.push({ status: 'pending', slack_channel: null, slack_ts: null, error: null, updated_at: '2026-10-01T00:00:00.000Z', ...r });
};
const claim = (id: string): void => { const r = row(id); if (r.status === 'pending') r.status = 'sending'; }; // as the claim RPC does
const REJECTED = 'Slack rejected message (not_in_channel); verify channel/token permissions';

beforeEach(() => { table.rows.length = 0; table.payloads.length = 0; });

describe('delivery state after Slack sends', () => {
  it('A-D: a failed send stores the error; a later successful retry is sent, clears it, keeps ids and timestamp', async () => {
    seed({ assignment_id: 'a1', status: 'sending' });
    await store.finish('a1', 'pending', undefined, undefined, REJECTED);
    expect(row('a1')).toMatchObject({ status: 'pending', error: REJECTED, slack_channel: null, slack_ts: null });      // A

    claim('a1');
    const before = Date.now();
    await store.finish('a1', 'sent', 'C123', '1728350000.000100');
    const sent = row('a1');
    expect(sent.status).toBe('sent');                                                                               // B
    expect(sent.error).toBeNull();                                                                                  // C
    expect(sent).toMatchObject({ slack_channel: 'C123', slack_ts: '1728350000.000100' });                           // D
    expect(Date.parse(sent.updated_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(table.payloads.at(-1)).toHaveProperty('error', null); // null survives serialization (undefined would not)
  });

  it('uncertain sends keep their error; failure paths are unchanged', async () => {
    seed({ assignment_id: 'u1', status: 'sending' });
    await store.finish('u1', 'uncertain', undefined, undefined, 'Delivery uncertain; reconcile in Slack before retry');
    expect(row('u1')).toMatchObject({ status: 'uncertain', error: 'Delivery uncertain; reconcile in Slack before retry' });
  });

  it('E: deliveries that are not being sent (already sent, pending, uncertain) are never touched', async () => {
    seed({ assignment_id: 's1', status: 'sent', slack_channel: 'C9', slack_ts: '1.1', error: REJECTED });
    seed({ assignment_id: 'p1', status: 'pending', error: REJECTED });
    seed({ assignment_id: 'x1', status: 'uncertain', error: 'Delivery uncertain' });
    const snapshot = structuredClone(table.rows);
    for (const id of ['s1', 'p1', 'x1']) await store.finish(id, 'sent', 'C123', '2.2');
    expect(table.rows).toEqual(snapshot);
  });

  it('F: finishing never creates delivery rows', async () => {
    seed({ assignment_id: 'a1', status: 'sending' });
    await store.finish('a1', 'sent', 'C123', '3.3');
    await store.finish('missing', 'sent', 'C123', '4.4');
    expect(table.rows.map(r => r.assignment_id)).toEqual(['a1']);
  });
});
