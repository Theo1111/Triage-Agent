import { google } from "googleapis";
import { createAuthenticatedClient } from "./oauth";
import * as oauthAccountsRepo from "@/src/repositories/oauthAccountsRepository";
import type { GmailHistoryResponse, GmailMessage, GmailWatchResponse } from "@/src/types/gmail";
import { env } from "@/src/config/env";
import { GMAIL_LABEL_INBOX } from "@/src/config/gmail";

// Build a Gmail API client for a monitored inbox using its stored OAuth credentials.
// Throws if the inbox has no associated oauth_account.
export async function createGmailClientForInbox(monitoredInboxId: string) {
  const account = await oauthAccountsRepo.findByInboxId(monitoredInboxId);
  if (!account) throw new Error(`No OAuth account found for inbox ${monitoredInboxId}`);

  const authClient = createAuthenticatedClient({
    accessToken: account.access_token,
    refreshToken: account.refresh_token,
    expiresAt: account.expires_at,
  });

  // When the token refreshes automatically, persist the new access token.
  authClient.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
      await oauthAccountsRepo.updateTokens({
        id: account.id,
        accessToken: tokens.access_token,
        expiresAt,
      });
    }
  });

  return buildGmailClient(authClient);
}

export function buildGmailClient(auth: ReturnType<typeof createAuthenticatedClient>) {
  const gmail = google.gmail({ version: "v1", auth });

  return {
    async watchInbox(): Promise<GmailWatchResponse> {
      const res = await gmail.users.watch({
        userId: "me",
        requestBody: {
          topicName: env.GOOGLE_PUBSUB_TOPIC,
          labelIds: [GMAIL_LABEL_INBOX],
        },
      });
      return res.data as GmailWatchResponse;
    },

    async listHistory(startHistoryId: string, pageToken?: string): Promise<GmailHistoryResponse> {
      const res = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        labelId: GMAIL_LABEL_INBOX,
        pageToken,
      });
      return res.data as GmailHistoryResponse;
    },

    async getMessage(messageId: string): Promise<GmailMessage> {
      const res = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });
      return res.data as GmailMessage;
    },

    async getAttachment(messageId: string, attachmentId: string): Promise<string | null> {
      const res = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: attachmentId,
      });
      return res.data.data ?? null; // base64url encoded bytes
    },
  };
}
