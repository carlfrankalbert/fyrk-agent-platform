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

export async function replyInThread(
  token: string,
  channel: string,
  threadTs: string,
  text: string,
): Promise<PostMessageResponse> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
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

export async function updateMessage(
  token: string,
  channel: string,
  ts: string,
  text: string,
): Promise<PostMessageResponse> {
  const res = await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, ts, text }),
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

export interface ThreadMessage {
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
}

export async function getThreadHistory(
  token: string,
  channel: string,
  threadTs: string,
): Promise<ThreadMessage[]> {
  const res = await fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=50`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Slack API HTTP error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { ok: boolean; messages?: ThreadMessage[]; error?: string };
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return data.messages ?? [];
}

export interface CanvasResponse {
  ok: boolean;
  canvas_id?: string;
  error?: string;
}

export async function createCanvas(
  token: string,
  title: string,
  markdown: string,
): Promise<CanvasResponse> {
  const res = await fetch('https://slack.com/api/canvases.create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      document_content: { type: 'markdown', markdown },
    }),
  });

  if (!res.ok) {
    throw new Error(`Slack Canvas API HTTP error ${res.status}: ${await res.text()}`);
  }

  return await res.json() as CanvasResponse;
}

export async function editCanvas(
  token: string,
  canvasId: string,
  markdown: string,
): Promise<CanvasResponse> {
  const res = await fetch('https://slack.com/api/canvases.edit', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      canvas_id: canvasId,
      changes: [{
        operation: 'replace',
        document_content: { type: 'markdown', markdown },
      }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Slack Canvas API HTTP error ${res.status}: ${await res.text()}`);
  }

  return await res.json() as CanvasResponse;
}

export async function addReaction(
  token: string,
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  const res = await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, timestamp, name }),
  });

  if (!res.ok) {
    throw new Error(`Slack API HTTP error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok && data.error !== 'already_reacted') {
    throw new Error(`Slack API error: ${data.error}`);
  }
}

export async function removeReaction(
  token: string,
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  const res = await fetch('https://slack.com/api/reactions.remove', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, timestamp, name }),
  });

  if (!res.ok) {
    throw new Error(`Slack API HTTP error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok && data.error !== 'no_reaction') {
    throw new Error(`Slack API error: ${data.error}`);
  }
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
  const expected = Buffer.from(`v0=${hmac}`);
  const received = Buffer.from(signature);

  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
