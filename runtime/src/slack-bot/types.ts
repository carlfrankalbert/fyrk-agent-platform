/**
 * A bot module decides *what* the FYRK Slack bot knows and how it answers.
 * The core (events, signature, dedup, threads, streaming, errors) knows nothing about any module's content.
 */
export interface BotModule {
  id: string;
  description: string;
  model: string;
  /**
   * `instructions` is sent as a plain system block. `context` (optional, typically large and static) is sent as a
   * second system block with cache_control ephemeral, so repeated questions hit the prompt cache.
   */
  buildSystemPrompt(): Promise<{ instructions: string; context?: string }>;
}

/** A Slack message the bot should answer, normalised from app_mention or message.im. */
export interface SlackBotEvent {
  eventId: string;
  type: 'app_mention' | 'message';
  channel: string;
  channelType?: string;
  user: string;
  text: string;
  /** ts of the user's message */
  ts: string;
  /** Set when the message is a reply in an existing thread */
  threadTs?: string;
  /** The bot's own Slack user id (from authorizations), used to strip mentions and recognise its own replies */
  botUserId?: string;
  /**
   * Channel thread reply without a mention: only answer if the bot has already replied in this thread.
   * Checked against the thread history before anything is posted.
   */
  requireBotInThread?: boolean;
}
