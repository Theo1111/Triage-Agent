import { randomUUID } from "crypto";
import { decodePubSubPayload } from "@/src/lib/pubsub/decode";
import { createGmailClientForInbox } from "@/src/lib/google/gmail";
import { parseHeaders, buildHeaderMap } from "@/src/lib/parsing/headers";
import { extractEmailBodies } from "@/src/lib/parsing/emailBody";
import { shouldIngestEmail } from "./filters";
import { logError } from "./ingestionErrors";
import { startRun, finishRun } from "./ingestionRuns";
import { processAttachmentsForEmail } from "./attachmentIngestion";
import { runAutoTriagePipeline } from "./autoTriagePipeline";
import { registerWatch } from "./gmailWatch";
import { env } from "@/src/config/env";
import * as inboxesRepo from "@/src/repositories/monitoredInboxesRepository";
import * as watchRepo from "@/src/repositories/gmailWatchStatesRepository";
import * as pubsubRepo from "@/src/repositories/pubsubNotificationsRepository";
import * as emailsRepo from "@/src/repositories/inboundEmailsRepository";
import type { IngestionResult, ProcessHistoryInput, ProcessMessageInput, ProcessMessageResult } from "@/src/types/ingestion";

// ── Types for manual sync ──────────────────────────────────────────────────────

export interface InboxSyncDetail {
  emailAddress: string;
  watchRenewed: boolean;
  historyExpired: boolean;
  messagesFound: number;
  newStored: number;
  errors: number;
  note?: string;
}

export interface ManualSyncResult {
  inboxesChecked: number;
  watchesRenewed: number;
  watchRenewFailures: number;
  totalMessagesFound: number;
  totalNewStored: number;
  totalDuplicatesSkipped: number;
  totalAutomatedAlertsSkipped: number;
  totalErrors: number;
  inboxResults: InboxSyncDetail[];
  status: "success" | "partial_success" | "failed" | "no_inboxes";
}

// ── Manual sync ───────────────────────────────────────────────────────────────
// Renews all Gmail watches and processes history since each inbox's last known
// historyId. Called by POST /api/gmail/sync (dashboard "Refresh Emails" button).
// If a historyId is too old (watch expired for too long), the gap is noted in
// the result — the watch is still renewed so future emails resume normally.

export async function manualSyncAllInboxes(): Promise<ManualSyncResult> {
  const inboxes = await inboxesRepo.findAllActive();

  const result: ManualSyncResult = {
    inboxesChecked: inboxes.length,
    watchesRenewed: 0,
    watchRenewFailures: 0,
    totalMessagesFound: 0,
    totalNewStored: 0,
    totalDuplicatesSkipped: 0,
    totalAutomatedAlertsSkipped: 0,
    totalErrors: 0,
    inboxResults: [],
    status: inboxes.length === 0 ? "no_inboxes" : "success",
  };

  if (inboxes.length === 0) {
    console.log("[manual-sync] No active inboxes configured");
    return result;
  }

  for (const inbox of inboxes) {
    const detail: InboxSyncDetail = {
      emailAddress: inbox.email_address,
      watchRenewed: false,
      historyExpired: false,
      messagesFound: 0,
      newStored: 0,
      errors: 0,
    };

    console.log(`[manual-sync] inbox=${inbox.email_address} — starting`);

    // 1. Renew the Gmail watch so PubSub push notifications keep arriving.
    const watchResult = await registerWatch(inbox.email_address);
    if (watchResult.success) {
      result.watchesRenewed++;
      detail.watchRenewed = true;
      console.log(`[manual-sync] watch renewed inbox=${inbox.email_address} historyId=${watchResult.historyId}`);
    } else {
      result.watchRenewFailures++;
      console.warn(`[manual-sync] watch renewal failed inbox=${inbox.email_address}: ${watchResult.error}`);
    }

    // 2. Pick a historyId to start from (prefer last processed, fall back to current / renewal).
    const watchState = await watchRepo.findByInboxId(inbox.id);
    const historyId =
      watchState?.last_processed_history_id ??
      watchState?.current_history_id ??
      watchResult.historyId;

    if (!historyId) {
      detail.note = "No historyId available. Watch registered; future emails will be delivered via PubSub.";
      detail.errors++;
      result.totalErrors++;
      result.inboxResults.push(detail);
      console.warn(`[manual-sync] inbox=${inbox.email_address} — no historyId, skipping history fetch`);
      continue;
    }

    // 3. Process history.
    const runId = randomUUID();
    const run = await startRun({
      runId,
      triggerType: "manual_rerun",
      triggerSource: "dashboard_manual_sync",
    });

    const counts: IngestionResult = {
      runId,
      messagesFound: 0,
      newMessagesStored: 0,
      externalMessagesStored: 0,
      duplicatesSkipped: 0,
      automatedAlertsSkipped: 0,
      attachmentsFound: 0,
      attachmentsStored: 0,
      attachmentParseFailures: 0,
      errors: 0,
      status: "success",
    };

    try {
      await processHistoryForInbox(
        {
          inboxId: inbox.id,
          emailAddress: inbox.email_address,
          incomingHistoryId: historyId,
          ingestionRunId: run.id,
          triggerType: "manual_rerun",
        },
        counts
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Gmail returns 404 / "Requested entity was not found" when a historyId is too old.
      const isExpiredHistory =
        msg.includes("not found") || msg.includes("404") || msg.toLowerCase().includes("starthistoryid");
      if (isExpiredHistory) {
        detail.historyExpired = true;
        detail.note =
          "History ID is too old — emails during the expiry gap cannot be recovered automatically. " +
          "Watch renewed so future emails will resume normally.";
        console.warn(`[manual-sync] inbox=${inbox.email_address} — history expired: ${msg}`);
      } else {
        detail.note = msg;
        console.error(`[manual-sync] inbox=${inbox.email_address} — history fetch failed:`, msg);
      }
      counts.errors++;
      counts.status = "failed";
    }

    detail.messagesFound = counts.messagesFound;
    detail.newStored    = counts.newMessagesStored;
    detail.errors      += counts.errors;

    result.totalMessagesFound      += counts.messagesFound;
    result.totalNewStored          += counts.newMessagesStored;
    result.totalDuplicatesSkipped  += counts.duplicatesSkipped;
    result.totalAutomatedAlertsSkipped += counts.automatedAlertsSkipped;
    result.totalErrors             += counts.errors;

    await finishRun(run, {
      inboxesChecked:        1,
      messagesFound:         counts.messagesFound,
      newMessagesStored:     counts.newMessagesStored,
      duplicatesSkipped:     counts.duplicatesSkipped,
      automatedAlertsSkipped: counts.automatedAlertsSkipped,
      attachmentsFound:      counts.attachmentsFound,
      attachmentsStored:     counts.attachmentsStored,
      attachmentParseFailures: counts.attachmentParseFailures,
      errors:                counts.errors,
    });

    result.inboxResults.push(detail);
  }

  // Aggregate status.
  if (result.totalErrors === 0 && result.status !== "no_inboxes") {
    result.status = "success";
  } else if (result.totalNewStored > 0 || result.totalDuplicatesSkipped > 0) {
    result.status = "partial_success";
  } else if (result.inboxesChecked > 0 && result.totalErrors > 0) {
    result.status = "failed";
  }

  console.log(
    `[manual-sync] done inboxes=${result.inboxesChecked} ` +
    `watchesRenewed=${result.watchesRenewed} ` +
    `found=${result.totalMessagesFound} ` +
    `stored=${result.totalNewStored} ` +
    `errors=${result.totalErrors}`
  );

  return result;
}

export async function processPubSubNotification(body: unknown): Promise<IngestionResult> {
  // Decode the Pub/Sub payload first so we can store it for debugging.
  let decoded: ReturnType<typeof decodePubSubPayload>;
  try {
    decoded = decodePubSubPayload(body);
  } catch (err) {
    await logError({ stage: "pubsub_decode_failed", error: err });
    return emptyResult("failed");
  }

  const { pubsubMessageId, emailAddress, historyId, rawPayload } = decoded;

  // Store raw notification — dedupe by pubsubMessageId.
  const { inserted, row: notification } = await pubsubRepo.insertIfNew({
    pubsubMessageId,
    emailAddress,
    historyId,
    rawPayload,
  });

  if (!inserted) {
    console.log(`[pubsub] Duplicate notification ${pubsubMessageId} — skipping`);
    await pubsubRepo.updateStatus(notification.id, "duplicate");
    return emptyResult("success");
  }

  await pubsubRepo.updateStatus(notification.id, "processing");

  // Find the monitored inbox.
  const inbox = await inboxesRepo.findByEmail(emailAddress);
  if (!inbox) {
    const msg = `No active inbox found for ${emailAddress}`;
    await logError({ stage: "history_fetch_failed", error: msg });
    await pubsubRepo.updateStatus(notification.id, "failed", msg);
    return emptyResult("failed");
  }

  // Start ingestion run.
  const runId = randomUUID();
  const run = await startRun({ runId, triggerType: "pubsub_push", triggerSource: pubsubMessageId });

  await watchRepo.updateLastNotificationAt(inbox.id);

  const counts: IngestionResult = {
    runId,
    messagesFound: 0,
    newMessagesStored: 0,
    externalMessagesStored: 0,
    duplicatesSkipped: 0,
    automatedAlertsSkipped: 0,
    attachmentsFound: 0,
    attachmentsStored: 0,
    attachmentParseFailures: 0,
    errors: 0,
    status: "success",
  };

  try {
    await processHistoryForInbox(
      {
        inboxId: inbox.id,
        emailAddress: inbox.email_address,
        incomingHistoryId: historyId,
        ingestionRunId: run.id,
        triggerType: "pubsub_push",
      },
      counts
    );

    counts.status = counts.errors > 0 ? (counts.newMessagesStored > 0 ? "partial_success" : "failed") : "success";
  } catch (err) {
    counts.errors++;
    counts.status = "failed";
    await logError({ ingestionRunId: run.id, monitoredInboxId: inbox.id, stage: "history_fetch_failed", error: err });
  }

  console.log(
    `[ingestion] run=${runId} ` +
    `messagesFound=${counts.messagesFound} ` +
    `newMessagesStored=${counts.newMessagesStored} ` +
    `externalMessagesStored=${counts.externalMessagesStored} ` +
    `duplicatesSkipped=${counts.duplicatesSkipped} ` +
    `automatedAlertsSkipped=${counts.automatedAlertsSkipped} ` +
    `attachmentsStored=${counts.attachmentsStored} ` +
    `errors=${counts.errors}`
  );

  await finishRun(run, {
    inboxesChecked: 1,
    messagesFound: counts.messagesFound,
    newMessagesStored: counts.newMessagesStored,
    duplicatesSkipped: counts.duplicatesSkipped,
    externalMessagesSkipped: 0,       // no longer filtered by sender domain
    automatedAlertsSkipped: counts.automatedAlertsSkipped,
    attachmentsFound: counts.attachmentsFound,
    attachmentsStored: counts.attachmentsStored,
    attachmentParseFailures: counts.attachmentParseFailures,
    errors: counts.errors,
  });

  await pubsubRepo.updateStatus(notification.id, counts.status === "failed" ? "failed" : "processed");

  return counts;
}

async function processHistoryForInbox(
  input: ProcessHistoryInput,
  counts: IngestionResult
): Promise<void> {
  const watchState = await watchRepo.findByInboxId(input.inboxId);
  const startHistoryId = watchState?.last_processed_history_id ?? input.incomingHistoryId;

  const gmail = await createGmailClientForInbox(input.inboxId);

  // Collect all message IDs from history pages.
  const messageIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const page = await gmail.listHistory(startHistoryId, pageToken);
    pageToken = page.nextPageToken;

    for (const item of page.history ?? []) {
      for (const added of item.messagesAdded ?? []) {
        if (added.message.id) messageIds.push(added.message.id);
      }
    }
  } while (pageToken);

  counts.messagesFound += messageIds.length;
  console.log(`[history] inbox=${input.emailAddress} start=${startHistoryId} found=${messageIds.length} messages`);

  // Process each message individually — one failure doesn't stop the rest.
  for (const messageId of messageIds) {
    try {
      const result = await processMessage(
        { inboxId: input.inboxId, emailAddress: input.emailAddress, messageId, ingestionRunId: input.ingestionRunId },
        counts
      );

      if (result.stored) {
        counts.newMessagesStored++;
        if (result.isExternal) counts.externalMessagesStored++;
      } else if (result.skipReason === "duplicate") {
        counts.duplicatesSkipped++;
      } else if (result.skipReason === "automated_alert") {
        counts.automatedAlertsSkipped++;
      }

      if (result.stored && result.inboundEmailId && env.AUTO_TRIAGE_NEW_EMAILS === "true") {
        try {
          await runAutoTriagePipeline(result.inboundEmailId);
        } catch (err) {
          console.error(`[ingestion] auto-triage uncaught error for email=${result.inboundEmailId}:`, err);
        }
      }
    } catch (err) {
      counts.errors++;
      await logError({
        ingestionRunId: input.ingestionRunId,
        monitoredInboxId: input.inboxId,
        gmailMessageId: messageId,
        stage: "message_fetch_failed",
        error: err,
      });
    }
  }

  // Only advance the history pointer after successful processing.
  await watchRepo.updateLastProcessedHistoryId(input.inboxId, input.incomingHistoryId);
}

async function processMessage(
  input: ProcessMessageInput,
  counts: IngestionResult
): Promise<ProcessMessageResult> {
  const gmail = await createGmailClientForInbox(input.inboxId);
  const message = await gmail.getMessage(input.messageId);

  if (!message.payload) {
    throw new Error(`Gmail message ${input.messageId} has no payload`);
  }

  const rawHeaders = message.payload.headers ?? [];
  const headerMap = buildHeaderMap(rawHeaders);
  const headers = parseHeaders(rawHeaders);
  const labelIds = message.labelIds ?? [];

  // Apply ingestion filters.
  const filterResult = shouldIngestEmail({
    senderEmail: headers.senderEmail,
    labelIds,
    headers: headerMap,
  });

  if (!filterResult.shouldIngest) {
    console.log(
      `[message] skip messageId=${input.messageId} reason=${filterResult.skipReason} sender=${headers.senderEmail}`
    );
    return { stored: false, skipped: true, skipReason: filterResult.skipReason };
  }

  const { textPlain, textHtml } = extractEmailBodies(message.payload);

  const gmailLink = `https://mail.google.com/mail/u/0/#inbox/${input.messageId}`;
  const internalDate = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : null;

  const { inserted, row: emailRow } = await emailsRepo.insertIfNew({
    monitoredInboxId: input.inboxId,
    sourceInboxEmail: input.emailAddress,
    gmailMessageId: message.id,
    gmailThreadId: message.threadId ?? null,
    gmailHistoryId: message.historyId ?? null,
    gmailInternalDate: internalDate,
    gmailLink,
    labelIds,
    senderEmail: headers.senderEmail,
    senderName: headers.senderName,
    recipientEmails: headers.to,
    ccEmails: headers.cc,
    bccEmails: headers.bcc,
    replyTo: headers.replyTo,
    subject: headers.subject,
    snippet: message.snippet ?? null,
    bodyText: textPlain,
    bodyHtml: textHtml,
    headersJson: headerMap,
    payloadJson: message.payload as Record<string, unknown>,
    sizeEstimate: message.sizeEstimate ?? null,
    receivedAt: headers.receivedAt,
    sentAt: headers.sentAt,
    isExternal: filterResult.isExternal,
    isAutomatedAlert: filterResult.isAutomatedAlert,
    hasAttachments: false, // updated below
    attachmentCount: 0,
  });

  if (!inserted) {
    return { stored: false, skipped: true, skipReason: "duplicate" };
  }

  console.log(
    `[message] stored messageId=${input.messageId} ` +
    `subject="${headers.subject}" ` +
    `sender=${headers.senderEmail} ` +
    `isExternal=${filterResult.isExternal}`
  );

  // Process attachments for the stored email.
  const attachmentResult = await processAttachmentsForEmail(
    {
      inboundEmailId: emailRow.id,
      emailAddress: input.emailAddress,
      messageId: input.messageId,
      ingestionRunId: input.ingestionRunId,
    },
    message.payload
  );

  counts.attachmentsFound += attachmentResult.found;
  counts.attachmentsStored += attachmentResult.stored;
  counts.attachmentParseFailures += attachmentResult.parseFailures;

  return { stored: true, skipped: false, inboundEmailId: emailRow.id, isExternal: filterResult.isExternal };
}

function emptyResult(status: IngestionResult["status"]): IngestionResult {
  return {
    runId: "",
    messagesFound: 0,
    newMessagesStored: 0,
    externalMessagesStored: 0,
    duplicatesSkipped: 0,
    automatedAlertsSkipped: 0,
    attachmentsFound: 0,
    attachmentsStored: 0,
    attachmentParseFailures: 0,
    errors: status === "failed" ? 1 : 0,
    status,
  };
}
