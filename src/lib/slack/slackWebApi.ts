// Minimal Slack Web API wrapper — methods needed for button interactions and routing.
// The initial alert post still uses the Incoming Webhook; this is only for updates + routing.

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

async function callSlackApi(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<SlackApiResponse> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Slack API HTTP ${res.status} on ${method}`);
  }
  return res.json() as Promise<SlackApiResponse>;
}

// Delete a message permanently. Requires the bot to own the message or have
// the chat:write scope. Non-throwing — logs and swallows on failure so callers
// can fall back to an update instead.
export async function deleteSlackMessage(
  token: string,
  channelId: string,
  messageTs: string
): Promise<boolean> {
  try {
    const result = await callSlackApi(token, "chat.delete", {
      channel: channelId,
      ts: messageTs,
    });
    return result.ok;
  } catch {
    return false;
  }
}

// Edit an existing message in place.
export async function updateSlackMessage(
  token: string,
  channelId: string,
  messageTs: string,
  text: string,
  blocks: unknown[]
): Promise<void> {
  const result = await callSlackApi(token, "chat.update", {
    channel: channelId,
    ts: messageTs,
    text,
    blocks,
  });
  if (!result.ok) {
    throw new Error(`chat.update failed: ${result.error ?? "unknown"}`);
  }
}

// Post a public thread reply under an existing message.
export async function postThreadReply(
  token: string,
  channelId: string,
  threadTs: string,
  text: string
): Promise<void> {
  const result = await callSlackApi(token, "chat.postMessage", {
    channel: channelId,
    thread_ts: threadTs,
    text,
  });
  if (!result.ok) {
    throw new Error(`chat.postMessage failed: ${result.error ?? "unknown"}`);
  }
}

// Post a standalone message (no thread) — used for routed DM notifications.
export async function postMessage(
  token: string,
  channelId: string,
  text: string,
  blocks: unknown[]
): Promise<void> {
  const result = await callSlackApi(token, "chat.postMessage", {
    channel: channelId,
    text,
    blocks,
  });
  if (!result.ok) {
    throw new Error(`chat.postMessage failed: ${result.error ?? "unknown"}`);
  }
}

// Open a DM channel with a user and return the channel ID.
// Slack requires conversations.open even for DMs; it is idempotent.
export async function openDmChannel(token: string, slackUserId: string): Promise<string> {
  const res = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ users: slackUserId }),
  });
  if (!res.ok) {
    throw new Error(`conversations.open HTTP ${res.status}`);
  }
  const data = (await res.json()) as { ok: boolean; error?: string; channel?: { id: string } };
  if (!data.ok || !data.channel?.id) {
    throw new Error(`conversations.open failed: ${data.error ?? "no channel returned"}`);
  }
  return data.channel.id;
}

// Open a Slack modal using the trigger_id from a button-click payload.
// trigger_id expires after 3 seconds — call this immediately on receipt.
export async function openModal(
  token: string,
  triggerId: string,
  view: unknown
): Promise<void> {
  const result = await callSlackApi(token, "views.open", {
    trigger_id: triggerId,
    view,
  });
  if (!result.ok) {
    throw new Error(`views.open failed: ${result.error ?? "unknown"}`);
  }
}
