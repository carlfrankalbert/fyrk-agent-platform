import { z } from 'zod';
import type { SlackBotEvent } from './types.js';

export const SlackUrlVerificationSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string(),
});

/** Loose envelope: unknown fields are allowed, the inner event is checked in classifyEvent. */
export const SlackEnvelopeSchema = z.object({
  type: z.string(),
  event_id: z.string().optional(),
  event: z.record(z.unknown()).optional(),
  authorizations: z.array(z.object({ user_id: z.string().optional() }).passthrough()).optional(),
}).passthrough();

const InnerEventSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  bot_id: z.string().optional(),
  user: z.string().optional(),
  text: z.string().optional(),
  ts: z.string(),
  thread_ts: z.string().optional(),
  channel: z.string(),
  channel_type: z.string().optional(),
}).passthrough();

export type SlackEnvelope = z.infer<typeof SlackEnvelopeSchema>;

export type Classification =
  | { handle: true; event: SlackBotEvent }
  | { handle: false; reason: string };

/**
 * Decide whether an event_callback envelope is a message the bot should answer.
 * Retries are filtered earlier (header based); this covers bot messages, subtypes and event types.
 */
export function classifyEvent(envelope: SlackEnvelope): Classification {
  if (envelope.type !== 'event_callback') return { handle: false, reason: `envelope type ${envelope.type}` };
  if (!envelope.event_id) return { handle: false, reason: 'missing event_id' };

  const parsed = InnerEventSchema.safeParse(envelope.event);
  if (!parsed.success) return { handle: false, reason: 'unrecognised event shape' };
  const ev = parsed.data;

  // Bot messages (including our own replies) and any subtype (edits, deletes, joins, bot_message, file_share ...)
  if (ev.bot_id) return { handle: false, reason: 'bot message' };
  if (ev.subtype) return { handle: false, reason: `subtype ${ev.subtype}` };
  if (!ev.user) return { handle: false, reason: 'no user' };

  const isMention = ev.type === 'app_mention';
  const isDm = ev.type === 'message' && ev.channel_type === 'im';
  if (!isMention && !isDm) return { handle: false, reason: `event ${ev.type}/${ev.channel_type ?? '-'}` };

  const botUserId = envelope.authorizations?.[0]?.user_id;
  const text = stripMention(ev.text ?? '', botUserId);
  if (!text) return { handle: false, reason: 'empty text' };

  return {
    handle: true,
    event: {
      eventId: envelope.event_id,
      type: isMention ? 'app_mention' : 'message',
      channel: ev.channel,
      channelType: ev.channel_type,
      user: ev.user,
      text,
      ts: ev.ts,
      threadTs: ev.thread_ts,
      botUserId,
    },
  };
}

/** Remove the bot's own `<@BOTID>` mentions; mentions of other people are kept as context. */
export function stripMention(text: string, botUserId?: string): string {
  const cleaned = botUserId ? text.split(`<@${botUserId}>`).join(' ') : text;
  return cleaned.replace(/[ \t]+/g, ' ').trim();
}
