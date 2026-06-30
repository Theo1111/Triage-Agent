import { queryOne, query } from "@/src/lib/db";
import type { EmailAttachment, ContentExtractionStatus } from "@/src/types/database";

export async function insertIfNew(input: {
  inboundEmailId: string;
  gmailAttachmentId: string;
  filename?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  isInline?: boolean;
  contentId?: string | null;
  contentDisposition?: string | null;
}): Promise<{ inserted: boolean; row: EmailAttachment }> {
  const row = await queryOne<EmailAttachment>(
    `INSERT INTO email_attachments
       (inbound_email_id, gmail_attachment_id, filename, mime_type, file_size,
        storage_bucket, storage_path, is_inline, content_id, content_disposition)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (inbound_email_id, gmail_attachment_id) DO NOTHING
     RETURNING *`,
    [
      input.inboundEmailId,
      input.gmailAttachmentId,
      input.filename ?? null,
      input.mimeType ?? null,
      input.fileSize ?? null,
      input.storageBucket ?? null,
      input.storagePath ?? null,
      input.isInline ?? false,
      input.contentId ?? null,
      input.contentDisposition ?? null,
    ]
  );

  if (row) return { inserted: true, row };

  const existing = await queryOne<EmailAttachment>(
    "SELECT * FROM email_attachments WHERE inbound_email_id = $1 AND gmail_attachment_id = $2",
    [input.inboundEmailId, input.gmailAttachmentId]
  );
  if (!existing) throw new Error(`Attachment ${input.gmailAttachmentId} vanished after conflict`);
  return { inserted: false, row: existing };
}

export async function updateExtraction(input: {
  id: string;
  contentText?: string | null;
  status: ContentExtractionStatus;
  error?: string | null;
}): Promise<void> {
  await queryOne(
    `UPDATE email_attachments SET
       content_text = $1,
       content_extraction_status = $2,
       content_extraction_error = $3,
       updated_at = now()
     WHERE id = $4`,
    [input.contentText ?? null, input.status, input.error ?? null, input.id]
  );
}

export async function findByEmailId(inboundEmailId: string): Promise<EmailAttachment[]> {
  return query<EmailAttachment>(
    "SELECT * FROM email_attachments WHERE inbound_email_id = $1",
    [inboundEmailId]
  );
}
