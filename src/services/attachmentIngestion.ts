import { createGmailClientForInbox } from "@/src/lib/google/gmail";
import * as inboxesRepo from "@/src/repositories/monitoredInboxesRepository";
import * as attachmentsRepo from "@/src/repositories/emailAttachmentsRepository";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import { detectAttachments, extractTextFromAttachment } from "@/src/lib/parsing/attachments";
import type { DetectAttachmentsResult } from "@/src/lib/parsing/attachments";
import { storeAttachment } from "@/src/lib/storage/attachments";
import { logError } from "./ingestionErrors";
import type { AttachmentProcessingInput, AttachmentProcessingResult } from "@/src/types/ingestion";
import type { GmailMessagePart } from "@/src/types/gmail";

export async function processAttachmentsForEmail(
  input: AttachmentProcessingInput,
  payload: GmailMessagePart
): Promise<AttachmentProcessingResult> {
  const result: AttachmentProcessingResult = { found: 0, stored: 0, parseFailures: 0 };

  const inbox = await inboxesRepo.findByEmail(input.emailAddress);
  if (!inbox) return result;

  const { parts: attachmentParts, stats }: DetectAttachmentsResult = detectAttachments(payload);
  result.found = attachmentParts.length;

  console.log(
    `[attachments] messageId=${input.messageId} partsScanned=${stats.totalPartsScanned} ` +
    `traditional=${stats.traditionalFound} inline=${stats.inlineFound} total=${attachmentParts.length}`
  );

  if (attachmentParts.length === 0) return result;

  const gmail = await createGmailClientForInbox(inbox.id);

  for (const part of attachmentParts) {
    try {
      // Fetch raw attachment bytes from Gmail.
      const base64Data = await gmail.getAttachment(input.messageId, part.attachmentId);
      if (!base64Data) {
        throw new Error(`Gmail returned no data for attachment ${part.attachmentId}`);
      }

      // Decode base64url to Buffer.
      const buffer = Buffer.from(base64Data.replace(/-/g, "+").replace(/_/g, "/"), "base64");

      // Store file.
      const { bucket, storagePath } = await storeAttachment({
        emailId: input.inboundEmailId,
        attachmentId: part.attachmentId,
        filename: part.filename,
        data: buffer,
      });

      // Upsert DB record.
      const { inserted, row } = await attachmentsRepo.insertIfNew({
        inboundEmailId: input.inboundEmailId,
        gmailAttachmentId: part.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType,
        fileSize: buffer.length,
        storageBucket: bucket,
        storagePath,
        isInline: part.isInline,
        contentId: part.contentId,
        contentDisposition: part.contentDisposition,
      });

      if (!inserted) {
        // Already stored — skip extraction.
        result.stored++;
        continue;
      }

      result.stored++;

      // Attempt text extraction.
      const { text, supported } = extractTextFromAttachment(part.mimeType, buffer);

      if (supported && text !== null) {
        await attachmentsRepo.updateExtraction({ id: row.id, contentText: text, status: "extracted" });
      } else if (!supported) {
        await attachmentsRepo.updateExtraction({ id: row.id, status: "unsupported" });
      }
    } catch (err) {
      result.parseFailures++;
      await logError({
        ingestionRunId: input.ingestionRunId,
        monitoredInboxId: inbox.id,
        inboundEmailId: input.inboundEmailId,
        gmailMessageId: input.messageId,
        stage: "attachment_fetch_failed",
        error: err,
      });
    }
  }

  // Update the email record's attachment counts.
  await inboundEmailsRepo.updateIngestionStatus(
    input.inboundEmailId,
    result.parseFailures > 0 ? "attachment_partial_failure" : "stored"
  );

  return result;
}
