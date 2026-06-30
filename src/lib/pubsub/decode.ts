import { z } from "zod";

// Shape of the raw Pub/Sub push payload delivered to our webhook.
const pubSubPushSchema = z.object({
  message: z.object({
    messageId: z.string(),
    publishTime: z.string().optional(),
    data: z.string(), // base64 encoded JSON
    attributes: z.record(z.string(), z.string()).optional(),
  }),
  subscription: z.string().optional(),
});

// Shape of the decoded Gmail notification data inside the Pub/Sub message.
const gmailNotificationSchema = z.object({
  emailAddress: z.string(),
  historyId: z.union([z.string(), z.number()]).transform(String),
});

export type PubSubPushPayload = z.infer<typeof pubSubPushSchema>;
export type GmailNotificationData = z.infer<typeof gmailNotificationSchema>;

export interface DecodedPubSubMessage {
  pubsubMessageId: string;
  emailAddress: string;
  historyId: string;
  rawPayload: Record<string, unknown>;
}

export function decodePubSubPayload(body: unknown): DecodedPubSubMessage {
  const parsed = pubSubPushSchema.parse(body);
  const rawPayload = body as Record<string, unknown>;

  // Gmail sends data as base64-encoded JSON.
  const jsonStr = Buffer.from(parsed.message.data, "base64").toString("utf-8");
  let decoded: unknown;
  try {
    decoded = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to JSON-parse Pub/Sub message data: ${jsonStr.slice(0, 200)}`);
  }

  const notification = gmailNotificationSchema.parse(decoded);

  return {
    pubsubMessageId: parsed.message.messageId,
    emailAddress: notification.emailAddress,
    historyId: notification.historyId,
    rawPayload,
  };
}
