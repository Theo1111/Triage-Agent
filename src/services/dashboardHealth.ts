// Aggregated operational health for the dashboard. Reuses existing repositories
// and reads only backend state — never credentials, tokens, raw model output, or
// email content. Produces plain-language checks with a recommended next action.

import { query } from "@/src/lib/db";
import * as watchRepo from "@/src/repositories/gmailWatchStatesRepository";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import * as classificationRunsRepo from "@/src/repositories/classificationRunsRepository";
import * as triageRepo from "@/src/repositories/triageItemsRepository";
import * as auditRepo from "@/src/repositories/agentAuditLogsRepository";
import { ensureTriageSchema } from "@/src/lib/ensureTriageSchema";

export type HealthLevel = "ok" | "warn" | "crit";

export interface HealthCheck {
  key: string;
  label: string;
  level: HealthLevel;
  value: string;
  detail: string;
  action?: string;
}

export interface DashboardHealth {
  generatedAt: string;
  overall: HealthLevel;
  checks: HealthCheck[];
}

function worst(levels: HealthLevel[]): HealthLevel {
  if (levels.includes("crit")) return "crit";
  if (levels.includes("warn")) return "warn";
  return "ok";
}

function ago(d: Date | string | null): string {
  if (!d) return "never";
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

export async function getDashboardHealth(): Promise<DashboardHealth> {
  await ensureTriageSchema();
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3600 * 1000);

  const checks: HealthCheck[] = [];

  // ── Gmail watches: last sync, expiration, oauth reconnect ──────────────────
  let watches: Awaited<ReturnType<typeof watchRepo.findAll>> = [];
  try {
    watches = await watchRepo.findAll();
  } catch {
    watches = [];
  }

  const lastSync = watches
    .map(w => (w.last_successful_sync_at ? new Date(w.last_successful_sync_at).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const lastSyncDate = lastSync > 0 ? new Date(lastSync) : null;
  const syncStale = lastSync > 0 && now - lastSync > 6 * 3600 * 1000;
  checks.push({
    key: "gmail_sync",
    label: "Gmail sync",
    level: watches.length === 0 ? "warn" : syncStale ? "warn" : "ok",
    value: watches.length === 0 ? "no inboxes" : ago(lastSyncDate),
    detail:
      watches.length === 0
        ? "No Gmail inboxes are being watched."
        : `Last successful sync ${ago(lastSyncDate)} across ${watches.length} inbox(es).`,
    action:
      watches.length === 0
        ? "Connect a Gmail inbox and start a watch."
        : syncStale
        ? "No sync in over 6 hours — check the Gmail watch and Pub/Sub."
        : undefined,
  });

  const expired = watches.filter(
    w => w.watch_expiration && new Date(w.watch_expiration).getTime() <= now
  );
  const expiringSoon = watches.filter(
    w =>
      w.watch_expiration &&
      new Date(w.watch_expiration).getTime() > now &&
      new Date(w.watch_expiration).getTime() - now < 24 * 3600 * 1000
  );
  checks.push({
    key: "gmail_watch",
    label: "Gmail watch",
    level: expired.length > 0 ? "crit" : expiringSoon.length > 0 ? "warn" : "ok",
    value:
      expired.length > 0
        ? `${expired.length} expired`
        : expiringSoon.length > 0
        ? `${expiringSoon.length} expiring`
        : "active",
    detail:
      expired.length > 0
        ? `${expired.length} watch(es) have expired and will stop delivering mail.`
        : expiringSoon.length > 0
        ? `${expiringSoon.length} watch(es) expire within 24 hours.`
        : "All Gmail watches are active and current.",
    action:
      expired.length > 0 || expiringSoon.length > 0
        ? "Renew Gmail watches (runs daily via cron; can be triggered manually)."
        : undefined,
  });

  const oauthInvalid = watches.filter(w => w.watch_status === "oauth_invalid");
  let refreshTokenCount = 0;
  try {
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM oauth_accounts WHERE refresh_token IS NOT NULL`
    );
    refreshTokenCount = Number(rows[0]?.count ?? 0);
  } catch {
    refreshTokenCount = 0;
  }
  checks.push({
    key: "oauth",
    label: "Google OAuth",
    level: oauthInvalid.length > 0 ? "crit" : refreshTokenCount === 0 ? "warn" : "ok",
    value:
      oauthInvalid.length > 0
        ? `${oauthInvalid.length} need reconnect`
        : refreshTokenCount === 0
        ? "not connected"
        : "connected",
    detail:
      oauthInvalid.length > 0
        ? `${oauthInvalid.length} inbox(es) need an OAuth reconnect before mail can sync.`
        : refreshTokenCount === 0
        ? "No stored Google refresh tokens were found."
        : "Google OAuth credentials are present.",
    action:
      oauthInvalid.length > 0 || refreshTokenCount === 0
        ? "Reconnect the Google account from the Gmail connection screen."
        : undefined,
  });

  // ── Classification backlog + failures ──────────────────────────────────────
  const [awaiting, failedEmails, failedRuns] = await Promise.all([
    inboundEmailsRepo.countByProcessingStatus("awaiting_classification").catch(() => 0),
    inboundEmailsRepo.countByProcessingStatus("classification_failed").catch(() => 0),
    classificationRunsRepo.countByStatusSince("failed", dayAgo).catch(() => 0),
  ]);
  checks.push({
    key: "classification_backlog",
    label: "Awaiting classification",
    level: awaiting > 50 ? "crit" : awaiting > 10 ? "warn" : "ok",
    value: String(awaiting),
    detail:
      awaiting === 0
        ? "No emails are waiting to be classified."
        : `${awaiting} email(s) are waiting to be classified.`,
    action: awaiting > 10 ? "Run the process-pending-emails cron to clear the backlog." : undefined,
  });
  checks.push({
    key: "classification_failures",
    label: "Classification failures",
    level: failedRuns > 0 || failedEmails > 0 ? "warn" : "ok",
    value: failedRuns > 0 ? `${failedRuns} (24h)` : failedEmails > 0 ? String(failedEmails) : "0",
    detail:
      failedRuns > 0
        ? `${failedRuns} classification run(s) failed in the last 24 hours.`
        : failedEmails > 0
        ? `${failedEmails} email(s) are in a failed classification state.`
        : "No recent classification failures.",
    action:
      failedRuns > 0 || failedEmails > 0
        ? "Check OpenAI availability and re-run failed classifications."
        : undefined,
  });

  // ── Manual review backlog ──────────────────────────────────────────────────
  const manualReview = await triageRepo.countByStatus("manual_review").catch(() => 0);
  checks.push({
    key: "manual_review",
    label: "Manual review",
    level: manualReview > 20 ? "warn" : "ok",
    value: String(manualReview),
    detail:
      manualReview === 0
        ? "No cases are waiting for manual review."
        : `${manualReview} case(s) need a human decision.`,
    action: manualReview > 20 ? "Work the Manual Review queue." : undefined,
  });

  // ── Slack delivery ─────────────────────────────────────────────────────────
  const [slackFailures, lastSlackSuccess] = await Promise.all([
    auditRepo.countByEventTypesSince(["slack_post_failed"], dayAgo).catch(() => 0),
    auditRepo.findLatestByEventTypes(["slack_post_created"]).catch(() => null),
  ]);
  checks.push({
    key: "slack_delivery",
    label: "Slack delivery",
    level: slackFailures > 0 ? "warn" : "ok",
    value: slackFailures > 0 ? `${slackFailures} failed (24h)` : ago(lastSlackSuccess?.created_at ?? null),
    detail:
      slackFailures > 0
        ? `${slackFailures} Slack delivery failure(s) in the last 24 hours. Last success ${ago(
            lastSlackSuccess?.created_at ?? null
          )}.`
        : lastSlackSuccess
        ? `Last successful Slack delivery ${ago(lastSlackSuccess.created_at)}.`
        : "No Slack deliveries recorded yet.",
    action: slackFailures > 0 ? "Check SLACK_BOT_TOKEN / webhook and Slack app status." : undefined,
  });

  return {
    generatedAt: new Date().toISOString(),
    overall: worst(checks.map(c => c.level)),
    checks,
  };
}
