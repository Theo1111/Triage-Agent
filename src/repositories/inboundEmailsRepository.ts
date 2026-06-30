import { query, queryOne } from "@/src/lib/db";
import type { InboundEmail, IngestionStatus, ProcessingStatus } from "@/src/types/database";

export interface InsertEmailInput {
  monitoredInboxId: string;
  sourceInboxEmail: string;
  gmailMessageId: string;
  gmailThreadId?: string | null;
  gmailHistoryId?: string | null;
  gmailInternalDate?: string | null;
  gmailLink?: string | null;
  labelIds?: string[] | null;
  senderEmail?: string | null;
  senderName?: string | null;
  recipientEmails?: string[] | null;
  ccEmails?: string[] | null;
  bccEmails?: string[] | null;
  replyTo?: string | null;
  subject?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  rawMime?: string | null;
  headersJson?: Record<string, string> | null;
  payloadJson?: Record<string, unknown> | null;
  sizeEstimate?: number | null;
  receivedAt?: Date | null;
  sentAt?: Date | null;
  isExternal?: boolean | null;
  isAutomatedAlert?: boolean | null;
  hasAttachments?: boolean;
  attachmentCount?: number;
  ingestionStatus?: IngestionStatus;
}

export async function insertIfNew(
  input: InsertEmailInput
): Promise<{ inserted: boolean; row: InboundEmail }> {
  const row = await queryOne<InboundEmail>(
    `INSERT INTO inbound_emails (
       monitored_inbox_id, source_inbox_email, gmail_message_id, gmail_thread_id,
       gmail_history_id, gmail_internal_date, gmail_link, label_ids,
       sender_email, sender_name, recipient_emails, cc_emails, bcc_emails,
       reply_to, subject, snippet, body_text, body_html, raw_mime,
       headers_json, payload_json, size_estimate, received_at, sent_at,
       is_external, is_automated_alert, has_attachments, attachment_count, ingestion_status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
     )
     ON CONFLICT (source_inbox_email, gmail_message_id) DO NOTHING
     RETURNING *`,
    [
      input.monitoredInboxId,
      input.sourceInboxEmail,
      input.gmailMessageId,
      input.gmailThreadId ?? null,
      input.gmailHistoryId ?? null,
      input.gmailInternalDate ?? null,
      input.gmailLink ?? null,
      input.labelIds ?? null,
      input.senderEmail ?? null,
      input.senderName ?? null,
      input.recipientEmails ?? null,
      input.ccEmails ?? null,
      input.bccEmails ?? null,
      input.replyTo ?? null,
      input.subject ?? null,
      input.snippet ?? null,
      input.bodyText ?? null,
      input.bodyHtml ?? null,
      input.rawMime ?? null,
      input.headersJson ? JSON.stringify(input.headersJson) : null,
      input.payloadJson ? JSON.stringify(input.payloadJson) : null,
      input.sizeEstimate ?? null,
      input.receivedAt ?? null,
      input.sentAt ?? null,
      input.isExternal ?? null,
      input.isAutomatedAlert ?? null,
      input.hasAttachments ?? false,
      input.attachmentCount ?? 0,
      input.ingestionStatus ?? "stored",
    ]
  );

  if (row) return { inserted: true, row };

  const existing = await queryOne<InboundEmail>(
    "SELECT * FROM inbound_emails WHERE source_inbox_email = $1 AND gmail_message_id = $2",
    [input.sourceInboxEmail, input.gmailMessageId]
  );
  if (!existing) throw new Error(`inbound_email for ${input.gmailMessageId} vanished after conflict`);
  return { inserted: false, row: existing };
}

export async function updateIngestionStatus(id: string, status: IngestionStatus): Promise<void> {
  await queryOne(
    "UPDATE inbound_emails SET ingestion_status = $1, updated_at = now() WHERE id = $2",
    [status, id]
  );
}

export async function updateProcessingStatus(id: string, status: ProcessingStatus): Promise<void> {
  await queryOne(
    "UPDATE inbound_emails SET processing_status = $1, updated_at = now() WHERE id = $2",
    [status, id]
  );
}

export async function findById(id: string): Promise<InboundEmail | null> {
  return queryOne<InboundEmail>("SELECT * FROM inbound_emails WHERE id = $1", [id]);
}

export async function findAwaitingClassification(limit = 50): Promise<InboundEmail[]> {
  return query<InboundEmail>(
    `SELECT * FROM inbound_emails
     WHERE processing_status = 'awaiting_classification'
       AND ingestion_status = 'stored'
     ORDER BY received_at ASC
     LIMIT $1`,
    [limit]
  );
}
