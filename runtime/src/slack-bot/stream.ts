import { updateMessage } from '../lib/slack.js';
import type { Logger } from '../lib/types.js';

export interface SlackStreamUpdater {
  update(text: string): void;
  flush(text: string): Promise<void>;
}

/**
 * Create a debounced Slack message updater for streaming (same debounce as Husmor in eb1f68a).
 * - `update(text)` schedules updateMessage with 500ms min interval and 80 char min delta
 * - `flush(text)` sends final updateMessage, cancels pending timer
 *
 * One addition: flush waits for an in-flight intermediate update, so a late " ..." update cannot overwrite the
 * final text.
 */
export function createSlackStreamUpdater(
  token: string,
  channel: string,
  messageTs: string,
  logger: Logger,
): SlackStreamUpdater {
  let lastSentText = '';
  let lastSentAt = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingText = '';
  let inFlight: Promise<unknown> = Promise.resolve();
  const MIN_INTERVAL_MS = 500;
  const MIN_CHAR_DELTA = 80;

  function doUpdate(text: string): void {
    const displayText = text + ' ...';
    lastSentText = text;
    lastSentAt = Date.now();
    inFlight = updateMessage(token, channel, messageTs, displayText)
      .catch((err: unknown) => logger.warn({ err }, 'Stream update failed'));
  }

  return {
    update(text: string): void {
      pendingText = text;
      const charDelta = text.length - lastSentText.length;
      const timeSinceLast = Date.now() - lastSentAt;

      if (charDelta >= MIN_CHAR_DELTA && timeSinceLast >= MIN_INTERVAL_MS) {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        doUpdate(text);
      } else if (!pendingTimer) {
        const delay = Math.max(0, MIN_INTERVAL_MS - timeSinceLast);
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          if (pendingText.length - lastSentText.length >= MIN_CHAR_DELTA) {
            doUpdate(pendingText);
          }
        }, delay);
      }
    },
    async flush(text: string): Promise<void> {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      await inFlight;
      try {
        await updateMessage(token, channel, messageTs, text);
      } catch (err) {
        logger.warn({ err }, 'Stream flush failed');
      }
    },
  };
}
