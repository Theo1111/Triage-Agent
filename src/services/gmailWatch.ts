import * as watchRepo from "@/src/repositories/gmailWatchStatesRepository";
import * as inboxesRepo from "@/src/repositories/monitoredInboxesRepository";
import { createGmailClientForInbox } from "@/src/lib/google/gmail";
import { env } from "@/src/config/env";
import { logError } from "./ingestionErrors";
import type { GmailWatchResult, WatchRenewalSummary } from "@/src/types/ingestion";

export async function registerWatch(emailAddress: string): Promise<GmailWatchResult> {
  const inbox = await inboxesRepo.findByEmail(emailAddress);
  if (!inbox) {
    return { success: false, error: `No active inbox found for ${emailAddress}` };
  }

  try {
    const gmail = await createGmailClientForInbox(inbox.id);
    const watchRes = await gmail.watchInbox();

    if (!watchRes.historyId || !watchRes.expiration) {
      throw new Error("Gmail watch response missing historyId or expiration");
    }

    const expiration = new Date(Number(watchRes.expiration));

    await watchRepo.upsertWatch({
      monitoredInboxId: inbox.id,
      emailAddress: inbox.email_address,
      topicName: env.GOOGLE_PUBSUB_TOPIC,
      currentHistoryId: watchRes.historyId,
      lastProcessedHistoryId: watchRes.historyId,
      watchExpiration: expiration,
      watchStatus: "active",
    });

    console.log(
      `[gmail-watch] Registered watch for ${emailAddress} historyId=${watchRes.historyId} expires=${expiration.toISOString()}`
    );

    return { success: true, historyId: watchRes.historyId, expiration };
  } catch (err) {
    await logError({
      monitoredInboxId: inbox.id,
      stage: "watch_failed",
      error: err,
    });
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function renewActiveWatches(): Promise<WatchRenewalSummary> {
  const inboxes = await inboxesRepo.findAllActive();
  const summary: WatchRenewalSummary = { checked: inboxes.length, renewed: 0, failed: 0 };

  for (const inbox of inboxes) {
    const result = await registerWatch(inbox.email_address);
    if (result.success) {
      summary.renewed++;
    } else {
      summary.failed++;
    }
  }

  return summary;
}
