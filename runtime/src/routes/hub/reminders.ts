import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getSupabase } from '../../lib/supabase.js';
import { requireAuth } from './auth.js';

const CreateReminderSchema = z.object({
  title: z.string().min(1),
  emoji: z.string().default('📌'),
  recurrence: z.string().default('daily'), // 'daily', 'weekdays', 'weekends', or '1,3,5'
});

interface ReminderRow {
  id: string;
  title: string;
  emoji: string;
  recurrence: string;
  active: boolean;
  created_at: string;
}

/** Check if a reminder is active today based on its recurrence pattern */
function isActiveToday(recurrence: string): boolean {
  const now = new Date();
  const jsDay = now.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1=Mon, ... 7=Sun

  switch (recurrence) {
    case 'daily':
      return true;
    case 'weekdays':
      return isoDay >= 1 && isoDay <= 5;
    case 'weekends':
      return isoDay >= 6;
    default: {
      // Comma-separated day numbers: '1,3,5'
      const days = recurrence.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      return days.includes(isoDay);
    }
  }
}

export async function hubReminderRoutes(fastify: FastifyInstance): Promise<void> {
  // Get today's active reminders
  fastify.get('/hub/api/reminders', async (request: FastifyRequest, reply: FastifyReply) => {
    const email = await requireAuth(request, reply);
    if (!email) return;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('hub_reminders')
      .select('id, title, emoji, recurrence, active, created_at')
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (error) {
      fastify.log.error(error, 'Failed to fetch reminders');
      return reply.status(500).send({ error: 'Database error' });
    }

    const rows = (data ?? []) as ReminderRow[];
    const todayReminders = rows.filter(r => isActiveToday(r.recurrence));

    return {
      reminders: todayReminders.map(r => ({
        id: r.id,
        title: r.title,
        emoji: r.emoji,
        recurrence: r.recurrence,
      })),
      all: rows.map(r => ({
        id: r.id,
        title: r.title,
        emoji: r.emoji,
        recurrence: r.recurrence,
        active: r.active,
      })),
    };
  });

  // Create reminder
  fastify.post('/hub/api/reminders', async (request: FastifyRequest, reply: FastifyReply) => {
    const email = await requireAuth(request, reply);
    if (!email) return;

    const parsed = CreateReminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid data', details: parsed.error.issues });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('hub_reminders')
      .insert({
        title: parsed.data.title,
        emoji: parsed.data.emoji,
        recurrence: parsed.data.recurrence,
        created_by: email,
      })
      .select('id, title, emoji, recurrence')
      .single();

    if (error) {
      fastify.log.error(error, 'Failed to create reminder');
      return reply.status(500).send({ error: 'Database error' });
    }

    return data;
  });

  // Delete reminder
  fastify.delete('/hub/api/reminders/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const email = await requireAuth(request, reply);
    if (!email) return;

    const { id } = request.params;
    const supabase = getSupabase();

    await supabase.from('hub_reminders').update({ active: false }).eq('id', id);
    return { ok: true };
  });
}
