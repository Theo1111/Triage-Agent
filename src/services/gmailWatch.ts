import * as watchRepo from "@/src/repositories/gmailWatchStatesRepository";
import * as inboxesRepo from "@/src/repositories/monitoredInboxesRepository";
import { createGmailClientForInbox } from "@/src/lib/google/gmail";
import { env } from "@/src/config/env";
import { logError } from "./ingestionErrors";
import type { GmailWatchResult, WatchRenewalSummary } from "@/src/types/ingestion";
import type { MonitoredInbox } from "@/src/types/database";

function isOauthInvalidGrant(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("invalid_grant") ||
    msg.includes("token has been expired or revoked") ||
    msg.includes("token has been revoked")
  );
}

// Performs the Gmail API watch call and updates DB state.
// Detects invalid_grant and marks the inbox permanently rather than retrying.
async function doRegisterWatch(inbox: MonitoredInbox): Promise<GmailWatchResult> {
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
      `[gmail-watch] Watch registered for ${inbox.email_address} historyId=${watchRes.historyId} expires=${expiration.toISOString()}`
    );

    return { success: true, historyId: watchRes.historyId, expiration };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    if (isOauthInvalidGrant(err)) {
      await watchRepo.markOauthInvalid(inbox.id);
      console.error(
        `[gmail-watch] invalid_grant for ${inbox.email_address} — OAuth token revoked. Inbox needs reconnect.`
      );
      return { success: false, error: errMsg, needsOauthReconnect: true };
    }

    await logError({ monitoredInboxId: inbox.id, stage: "watch_failed", error: err });
    await watchRepo.setStatus(inbox.id, "renewal_failed");
    return { success: false, error: errMsg, needsOauthReconnect: false };
  }
}

// Register a watch by email address. Used by the Gmail OAuth callback.
export async function registerWatch(emailAddress: string): Promise<GmailWatchResult> {
  const inbox = await inboxesRepo.findByEmail(emailAddress);
  if (!inbox) {
    return { success: false, error: `No active inbox found for ${emailAddress}` };
  }
  return doRegisterWatch(inbox);
}

// Selective renewal: only inboxes whose watch expires within 24h, has expired,
// is missing, or is in a non-active status. Skips oauth_invalid (needs human reconnect).
// Use this for the daily cron job.
export async function renewWatchesDueSoon(): Promise<WatchRenewalSummary> {
  const watches = await watchRepo.findAllNeedingRenewal();
  const summary: WatchRenewalSummary = {
    checked: watches.length,
    renewed: 0,
    failed: 0,
    oauthInvalid: 0,
  };

  for (const watch of watches) {
    const inbox = await inboxesRepo.findById(watch.monitored_inbox_id);
    if (!inbox) continue;

    const expiresInMs = watch.watch_expiration
      ? new Date(watch.watch_expiration).getTime() - Date.now()
      : null;
    const expiresLabel = expiresInMs !== null
      ? expiresInMs <= 0
        ? "EXPIRED"
        : `${Math.round(expiresInMs / 3_600_000)}h`
      : "none";

    console.log(
      `[gmail-watch] Renewing watch for ${watch.email_address} (status=${watch.watch_status}, expires=${expiresLabel})`
    );

    const result = await doRegisterWatch(inbox);
    if (result.success) {
      summary.renewed++;
    } else if (result.needsOauthReconnect) {
      summary.oauthInvalid = (summary.oauthInvalid ?? 0) + 1;
    } else {
      summary.failed++;
    }
  }

  return summary;
}

// Renews watches for ALL active inboxes regardless of expiry. Used by manual sync.
// Also detects invalid_grant and marks affected inboxes.
export async function renewActiveWatches(): Promise<WatchRenewalSummary> {
  const inboxes = await inboxesRepo.findAllActive();
  const summary: WatchRenewalSummary = {
    checked: inboxes.length,
    renewed: 0,
    failed: 0,
    oauthInvalid: 0,
  };

  for (const inbox of inboxes) {
    const result = await doRegisterWatch(inbox);
    if (result.success) {
      summary.renewed++;
    } else if (result.needsOauthReconnect) {
      summary.oauthInvalid = (summary.oauthInvalid ?? 0) + 1;
    } else {
      summary.failed++;
    }
  }

  return summary;
}
