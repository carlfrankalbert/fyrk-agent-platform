import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface PostMessageResponse {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

export async function postMessage(
  token: string,
  channel: string,
  blocks: SlackBlock[],
  text: string,
): Promise<PostMessageResponse> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, blocks, text }),
  });

  if (!res.ok) {
    throw new Error(`Slack API HTTP error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as PostMessageResponse;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return data;
}

export function verifySignature(
  signingSecret: string,
  headers: { 'x-slack-signature'?: string; 'x-slack-request-timestamp'?: string },
  rawBody: string,
): boolean {
  const timestamp = headers['x-slack-request-timestamp'];
  const signature = headers['x-slack-signature'];

  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');
  const expected = `v0=${hmac}`;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
