import { NextResponse } from "next/server";
import { query, queryOne } from "@/src/lib/db";
import { env } from "@/src/config/env";

export const dynamic = "force-dynamic";

// GET /api/gmail/sync/health
// Development diagnostic: checks every layer the ingestion pipeline depends on.
//
// Example response:
// {
//   "ok": true,
//   "dbConnected": true,
//   "inboxCount": 1,
//   "oauthConfigured": true,
//   "watchStatus": [{ "email": "ops@...", "status": "active", "expiresIn": "3d 4h", "lastSync": "..." }],
//   "envVarsPresent": { "GOOGLE_PUBSUB_TOPIC": true, "GOOGLE_CLIENT_ID": true, ... },
//   "message": "All ingestion dependencies look healthy."
// }

interface WatchRow {
  email_address: string;
  watch_status: string;
  watch_expiration: Date | null;
  last_processed_history_id: string | null;
  last_successful_sync_at: Date | null;
  last_notification_at: Date | null;
}

function formatTimeLeft(expiration: Date | null): string | null {
  if (!expiration) return null;
  const ms = new Date(expiration).getTime() - Date.now();
  if (ms <= 0) return "EXPIRED";
  const hours = Math.floor(ms / 3_600_000);
  const days  = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return days > 0 ? `${days}d ${remainHours}h` : `${hours}h`;
}

export async function GET() {
  const checks: Record<string, unknown> = {};
  let allOk = true;

  // 1. DB connectivity
  try {
    await queryOne(`SELECT 1 AS ping`);
    checks.dbConnected = true;
  } catch (err) {
    checks.dbConnected = false;
    checks.dbError = err instanceof Error ? err.message : String(err);
    allOk = false;
    return NextResponse.json({ ok: false, ...checks, message: "Cannot reach the database." }, { status: 503 });
  }

  // 2. Active inboxes
  let inboxCount = 0;
  try {
    const row = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM monitored_inboxes WHERE is_active = true`);
    inboxCount = Number(row?.count ?? 0);
    checks.inboxCount = inboxCount;
    if (inboxCount === 0) allOk = false;
  } catch {
    checks.inboxCount = null;
    checks.inboxTableError = "monitored_inboxes table missing or inaccessible";
    allOk = false;
  }

  // 3. OAuth accounts (Gmail credentials)
  let oauthCount = 0;
  try {
    const row = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM oauth_accounts WHERE refresh_token IS NOT NULL`);
    oauthCount = Number(row?.count ?? 0);
    checks.oauthConfigured = oauthCount > 0;
    if (oauthCount === 0) allOk = false;
  } catch {
    checks.oauthConfigured = null;
    checks.oauthError = "oauth_accounts table missing or inaccessible";
    allOk = false;
  }

  // 4. Gmail watch states
  try {
    const watches = await query<WatchRow>(
      `SELECT email_address, watch_status, watch_expiration,
              last_processed_history_id, last_successful_sync_at, last_notification_at
       FROM gmail_watch_states
       ORDER BY email_address`
    );
    checks.watchStatus = watches.map(w => ({
      email:        w.email_address,
      status:       w.watch_status,
      expiresIn:    formatTimeLeft(w.watch_expiration),
      lastSync:     w.last_successful_sync_at?.toISOString() ?? null,
      lastNotified: w.last_notification_at?.toISOString() ?? null,
      hasHistoryId: !!w.last_processed_history_id,
      needsReconnect: w.watch_status === "oauth_invalid",
    }));
    const anyExpired = watches.some(w =>
      w.watch_status === "oauth_invalid" ||
      w.watch_status !== "active" ||
      (w.watch_expiration && new Date(w.watch_expiration) < new Date())
    );
    if (anyExpired) allOk = false;
  } catch {
    checks.watchStatus = null;
    checks.watchError = "gmail_watch_states table missing or inaccessible";
    allOk = false;
  }

  // 5. Required env vars
  const envChecks = {
    GOOGLE_PUBSUB_TOPIC:    !!env.GOOGLE_PUBSUB_TOPIC,
    GOOGLE_CLIENT_ID:       !!env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET:   !!env.GOOGLE_CLIENT_SECRET,
    OPENAI_API_KEY:         !!env.OPENAI_API_KEY,
    SLACK_BOT_TOKEN:        !!env.SLACK_BOT_TOKEN,
    DATABASE_URL:           true, // if we got here, the DB is connected
    DASHBOARD_OPERATOR_SESSION_SECRET: !!env.DASHBOARD_OPERATOR_SESSION_SECRET,
  };
  checks.envVarsPresent = envChecks;
  if (Object.values(envChecks).some(v => !v)) allOk = false;

  // 6. Compose message
  const messages: string[] = [];
  if (inboxCount === 0)  messages.push("No active inboxes — add one at /api/gmail/watch.");
  if (oauthCount === 0)  messages.push("No OAuth credentials — run the Gmail OAuth flow first.");
  const watchStatusArr = (checks.watchStatus as { status: string; expiresIn: string | null }[] | null) ?? [];
  const oauthInvalidWatches = watchStatusArr.filter(w => w.status === "oauth_invalid");
  const expiredWatches = watchStatusArr.filter(w => w.status !== "oauth_invalid" && (w.expiresIn === "EXPIRED" || w.status !== "active"));
  if (oauthInvalidWatches.length > 0) messages.push(`${oauthInvalidWatches.length} inbox(es) need OAuth reconnect — visit /api/auth/google.`);
  if (expiredWatches.length > 0) messages.push(`${expiredWatches.length} watch(es) expired — POST /api/gmail/renew-watches or click Refresh Emails.`);

  const message = allOk
    ? "All ingestion dependencies look healthy."
    : messages.join(" ");

  return NextResponse.json({ ok: allOk, ...checks, message });
}
