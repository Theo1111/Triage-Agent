import { queryOne } from "@/src/lib/db";
import type { GmailWatchState, WatchStatus } from "@/src/types/database";

export async function findByInboxId(monitoredInboxId: string): Promise<GmailWatchState | null> {
  return queryOne<GmailWatchState>(
    "SELECT * FROM gmail_watch_states WHERE monitored_inbox_id = $1",
    [monitoredInboxId]
  );
}

export async function findByEmail(emailAddress: string): Promise<GmailWatchState | null> {
  return queryOne<GmailWatchState>(
    "SELECT * FROM gmail_watch_states WHERE email_address = $1",
    [emailAddress]
  );
}

export async function upsertWatch(input: {
  monitoredInboxId: string;
  emailAddress: string;
  topicName: string;
  currentHistoryId: string;
  lastProcessedHistoryId: string;
  watchExpiration: Date;
  watchStatus: WatchStatus;
}): Promise<GmailWatchState> {
  const row = await queryOne<GmailWatchState>(
    `INSERT INTO gmail_watch_states
       (monitored_inbox_id, email_address, topic_name, current_history_id, last_processed_history_id,
        watch_expiration, watch_status, last_watch_started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (monitored_inbox_id) DO UPDATE SET
       topic_name = EXCLUDED.topic_name,
       current_history_id = EXCLUDED.current_history_id,
       last_processed_history_id = EXCLUDED.last_processed_history_id,
       watch_expiration = EXCLUDED.watch_expiration,
       watch_status = EXCLUDED.watch_status,
       last_watch_started_at = now(),
       updated_at = now()
     RETURNING *`,
    [
      input.monitoredInboxId,
      input.emailAddress,
      input.topicName,
      input.currentHistoryId,
      input.lastProcessedHistoryId,
      input.watchExpiration,
      input.watchStatus,
    ]
  );
  if (!row) throw new Error(`Failed to upsert watch state for inbox ${input.monitoredInboxId}`);
  return row;
}

export async function updateLastProcessedHistoryId(
  monitoredInboxId: string,
  historyId: string
): Promise<void> {
  await queryOne(
    `UPDATE gmail_watch_states SET
       last_processed_history_id = $1,
       last_successful_sync_at = now(),
       updated_at = now()
     WHERE monitored_inbox_id = $2`,
    [historyId, monitoredInboxId]
  );
}

export async function updateLastNotificationAt(monitoredInboxId: string): Promise<void> {
  await queryOne(
    "UPDATE gmail_watch_states SET last_notification_at = now(), updated_at = now() WHERE monitored_inbox_id = $1",
    [monitoredInboxId]
  );
}

export async function setStatus(monitoredInboxId: string, status: WatchStatus): Promise<void> {
  await queryOne(
    "UPDATE gmail_watch_states SET watch_status = $1, updated_at = now() WHERE monitored_inbox_id = $2",
    [status, monitoredInboxId]
  );
}
