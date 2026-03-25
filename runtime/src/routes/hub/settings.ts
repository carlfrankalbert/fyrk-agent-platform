import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getSupabase } from '../../lib/supabase.js';
import { requireAuth } from './auth.js';

// Settings stored as family_preferences rows with known keys
const SETTINGS_KEYS = [
  'dinner_time',       // "17:00"
  'proactive_enabled', // true/false
  'proactive_voice',   // true/false — speak proactive messages aloud
  'household_name',    // "Familien Albert"
  'household_size',    // number of people
  'country',           // "NO", "SE", "DK"
  'day_types',         // {1:"rask",3:"fisk",5:"koselig",6:"pizza"} — day-of-week → type
  'staples',           // ["pasta","ris","løk","hvitløk","egg","smør","olje","tomat på boks"]
  'fish_target',       // weekly fish meals target (default 2)
  'veggie_target',     // weekly vegetar/belgvekst target (default 1)
  'max_cooking_time',  // max minutes per meal (default 45)
  'traditions',        // {5:"Taco"} — day-of-week → fixed meal name
] as const;

const UpdateSettingsSchema = z.object({
  dinner_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  proactive_enabled: z.boolean().optional(),
  proactive_voice: z.boolean().optional(),
  household_name: z.string().max(50).optional(),
  household_size: z.number().int().min(1).max(8).optional(),
  country: z.enum(['NO', 'SE', 'DK']).optional(),
  day_types: z.record(z.string(), z.string()).optional(),
  staples: z.array(z.string()).optional(),
  fish_target: z.number().int().min(0).max(7).optional(),
  veggie_target: z.number().int().min(0).max(7).optional(),
  max_cooking_time: z.number().int().min(10).max(120).optional(),
  traditions: z.record(z.string(), z.string()).optional(),
});

export async function hubSettingsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /hub/api/settings — fetch all settings
  fastify.get('/hub/api/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const supabase = getSupabase();
    const { data } = await supabase
      .from('family_preferences')
      .select('key, value')
      .in('key', [...SETTINGS_KEYS]);

    const settings: Record<string, unknown> = {
      dinner_time: '17:00',
      proactive_enabled: true,
      proactive_voice: true,
      household_name: '',
      household_size: 4,
      country: 'NO',
      day_types: {},
      staples: ['pasta', 'ris', 'løk', 'hvitløk', 'egg', 'smør', 'olje', 'tomat på boks', 'salt', 'pepper'],
      fish_target: 2,
      veggie_target: 1,
      max_cooking_time: 45,
      traditions: {},
    };

    if (data) {
      for (const row of data) {
        settings[row.key] = row.value;
      }
    }

    return settings;
  });

  // PUT /hub/api/settings — update settings
  fastify.put('/hub/api/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const parsed = UpdateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const supabase = getSupabase();
    const updates = parsed.data;

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;

      await supabase
        .from('family_preferences')
        .upsert(
          { household_id: 'default', key, value },
          { onConflict: 'household_id,key' }
        );
    }

    return { ok: true };
  });
}
