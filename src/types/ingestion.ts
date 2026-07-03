import type { IngestionRunTrigger } from "./database";

// Result of processing a single Pub/Sub notification through the full pipeline.
export interface IngestionResult {
  runId: string;
  messagesFound: number;
  newMessagesStored: number;
  externalMessagesStored: number;   // stored emails whose sender is outside INTERNAL_EMAIL_DOMAINS
  duplicatesSkipped: number;
  automatedAlertsSkipped: number;   // no-reply/noreply/alerts senders without operational signal
  attachmentsFound: number;
  attachmentsStored: number;
  attachmentParseFailures: number;
  errors: number;
  status: "success" | "partial_success" | "failed";
}

export interface ProcessHistoryInput {
  inboxId: string;
  emailAddress: string;
  incomingHistoryId: string;
  ingestionRunId: string;
  triggerType: IngestionRunTrigger;
}

export interface ProcessMessageInput {
  inboxId: string;
  emailAddress: string;
  messageId: string;
  ingestionRunId: string;
}

export interface ProcessMessageResult {
  stored: boolean;
  skipped: boolean;
  skipReason?: "duplicate" | "automated_alert" | "not_inbox";
  inboundEmailId?: string;
  isExternal?: boolean;  // set when stored=true, reflects is_external label on the email
}

export interface AttachmentProcessingInput {
  inboundEmailId: string;
  emailAddress: string;
  messageId: string;
  ingestionRunId: string;
}

export interface AttachmentProcessingResult {
  found: number;
  stored: number;
  parseFailures: number;
}

export interface EmailFilterInput {
  senderEmail: string;
  labelIds: string[];
  headers: Record<string, string>;
}

export interface EmailFilterResult {
  shouldIngest: boolean;
  isExternal: boolean;
  isAutomatedAlert: boolean;
  hasInboxLabel: boolean;
  skipReason?: "automated_alert" | "not_inbox";
}

export interface GmailWatchResult {
  success: boolean;
  historyId?: string;
  expiration?: Date;
  error?: string;
  needsOauthReconnect?: boolean;
}

export interface WatchRenewalSummary {
  checked: number;
  renewed: number;
  failed: number;
  oauthInvalid?: number;
}
