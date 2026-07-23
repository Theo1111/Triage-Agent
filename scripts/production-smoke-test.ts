/* eslint-disable @typescript-eslint/no-explicit-any */
// Safe, read-only-by-default production smoke test.
//
//   npm run test:smoke                       # read-only checks
//   npm run test:smoke -- --process-one --email-id=<uuid> --confirm
//                                            # write mode: process ONE named email
//
// Never selects or processes an arbitrary real customer email — write mode
// requires an explicit --email-id AND --confirm. Never prints secret values.

import { query, queryOne } from "../src/lib/db";

type Status = "PASS" | "WARN" | "FAIL";
interface Check {
  name: string;
  status: Status;
  detail: string;
  action?: string;
}

const checks: Check[] = [];
function record(name: string, status: Status, detail: string, action?: string) {
  checks.push({ name, status, detail, action });
}

function present(name: string): boolean {
  return typeof process.env[name] === "string" && process.env[name]!.length > 0;
}

async function countOf(sql: string, params: unknown[] = []): Promise<number | null> {
  try {
    const row = await queryOne<{ count: string }>(sql, params);
    return Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

async function tableExists(name: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
    [name]
  );
  return !!row?.exists;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2) AS exists`,
    [table, column]
  );
  return !!row?.exists;
}

async function main() {
  const args = process.argv.slice(2);
  const processOne = args.includes("--process-one");
  const confirm = args.includes("--confirm");
  const emailId = args.find(a => a.startsWith("--email-id="))?.slice("--email-id=".length);

  // 1. Database connectivity.
  try {
    await query("SELECT 1 AS ping");
    record("Database connectivity", "PASS", "Reached the database.");
  } catch (err) {
    record("Database connectivity", "FAIL", `Cannot reach DB: ${(err as Error).message}`, "Check DATABASE_URL / network.");
    return finish(); // nothing else will work
  }

  // 2. Required tables + key columns.
  const requiredTables = [
    "inbound_emails", "email_classifications", "triage_items", "agent_audit_logs",
    "gmail_watch_states", "operator_profiles",
  ];
  for (const t of requiredTables) {
    record(`Table ${t}`, (await tableExists(t)) ? "PASS" : "FAIL", (await tableExists(t)) ? "present" : "missing",
      "Run migrations.");
  }
  const threadCol = await columnExists("triage_items", "gmail_thread_id");
  record("triage_items.gmail_thread_id", threadCol ? "PASS" : "WARN", threadCol ? "present" : "missing",
    threadCol ? undefined : "Apply migration 008.");
  const supersedeCol = await columnExists("triage_items", "superseded_by_triage_item_id");
  record("triage_items.superseded_by_triage_item_id", supersedeCol ? "PASS" : "WARN", supersedeCol ? "present" : "missing",
    supersedeCol ? undefined : "Apply migration 008/009.");
  const correctionsTable = await tableExists("human_classification_corrections");
  record("human_classification_corrections", correctionsTable ? "PASS" : "WARN", correctionsTable ? "present" : "missing",
    correctionsTable ? undefined : "Apply migration 010.");

  // 3. Operator session config.
  record("Operator session secret", present("DASHBOARD_OPERATOR_SESSION_SECRET") ? "PASS" : "WARN",
    present("DASHBOARD_OPERATOR_SESSION_SECRET") ? "configured" : "not set",
    present("DASHBOARD_OPERATOR_SESSION_SECRET") ? undefined : "Set DASHBOARD_OPERATOR_SESSION_SECRET in production.");
  const opCount = await countOf("SELECT COUNT(*)::text AS count FROM operator_profiles");
  record("Operator profiles", (opCount ?? 0) > 0 ? "PASS" : "WARN", `${opCount ?? "?"} profiles`,
    (opCount ?? 0) > 0 ? undefined : "Create at least one operator.");

  // 4. Gmail watch state.
  const watches = await query<any>(
    `SELECT email_address, watch_status, watch_expiration, last_successful_sync_at FROM gmail_watch_states`
  ).catch(() => []);
  if (watches.length === 0) {
    record("Gmail watches", "WARN", "No watches registered.", "Connect an inbox and start a watch.");
  } else {
    const expired = watches.filter((w: any) => w.watch_expiration && new Date(w.watch_expiration).getTime() <= Date.now());
    const oauthInvalid = watches.filter((w: any) => w.watch_status === "oauth_invalid");
    record("Gmail watches", expired.length || oauthInvalid.length ? "WARN" : "PASS",
      `${watches.length} watch(es); ${expired.length} expired; ${oauthInvalid.length} need reconnect`,
      expired.length || oauthInvalid.length ? "Renew watches / reconnect OAuth." : undefined);
  }

  // 5. Backlog.
  const backlog = await countOf("SELECT COUNT(*)::text AS count FROM inbound_emails WHERE processing_status = 'awaiting_classification'");
  record("Classification backlog", (backlog ?? 0) > 50 ? "WARN" : "PASS", `${backlog ?? "?"} awaiting`,
    (backlog ?? 0) > 50 ? "Run process-pending-emails cron." : undefined);

  // 6. Config presence (never prints values).
  record("OpenAI configured", present("OPENAI_API_KEY") ? "PASS" : "FAIL", present("OPENAI_API_KEY") ? "set" : "missing",
    present("OPENAI_API_KEY") ? undefined : "Set OPENAI_API_KEY.");
  record("Slack configured", present("SLACK_WEBHOOK_URL") || present("SLACK_BOT_TOKEN") ? "PASS" : "WARN",
    present("SLACK_BOT_TOKEN") ? "bot token set" : present("SLACK_WEBHOOK_URL") ? "webhook set" : "none",
    present("SLACK_WEBHOOK_URL") || present("SLACK_BOT_TOKEN") ? undefined : "Configure Slack to enable alerts.");
  record("Paperclip secret", present("PAPERCLIP_HEARTBEAT_SECRET") ? "PASS" : "WARN",
    present("PAPERCLIP_HEARTBEAT_SECRET") ? "set" : "missing",
    present("PAPERCLIP_HEARTBEAT_SECRET") ? undefined : "Set PAPERCLIP_HEARTBEAT_SECRET before enabling Paperclip.");
  record("Cron secret", present("CRON_SECRET") ? "PASS" : "WARN", present("CRON_SECRET") ? "set" : "missing",
    present("CRON_SECRET") ? undefined : "Set CRON_SECRET (required in production).");

  // 7. Latest successful classification + Slack delivery.
  const lastClass = await queryOne<{ ts: string }>(
    `SELECT to_char(max(classified_at), 'YYYY-MM-DD"T"HH24:MI:SSZ') AS ts FROM email_classifications`
  ).catch(() => null);
  record("Latest classification", lastClass?.ts ? "PASS" : "WARN", lastClass?.ts ?? "none recorded");
  const lastSlack = await queryOne<{ ts: string }>(
    `SELECT to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SSZ') AS ts FROM agent_audit_logs WHERE event_type = 'slack_post_created'`
  ).catch(() => null);
  record("Latest Slack delivery", lastSlack?.ts ? "PASS" : "WARN", lastSlack?.ts ?? "none recorded");

  // 8. Optional write mode — process exactly one explicitly named email.
  if (processOne) {
    if (!emailId || !confirm) {
      record("Write mode", "FAIL", "Refused: write mode needs --email-id=<uuid> AND --confirm.",
        "Re-run with an explicit test email id and --confirm.");
    } else {
      const exists = await queryOne<{ id: string }>(`SELECT id FROM inbound_emails WHERE id = $1`, [emailId]);
      if (!exists) {
        record("Write mode", "FAIL", `No inbound_email with id ${emailId}.`);
      } else {
        try {
          const { runAutoTriagePipeline } = await import("../src/services/autoTriagePipeline");
          const result = await runAutoTriagePipeline(emailId);
          record("Write mode", result.error ? "FAIL" : "PASS",
            `Processed ${emailId}: ${result.error ? `error ${result.error}` : result.skipped ? `skipped (${result.skipReason})` : "classified"}`);
        } catch (err) {
          record("Write mode", "FAIL", `Pipeline threw: ${(err as Error).message}`);
        }
      }
    }
  }

  finish();
}

function finish() {
  console.log("\n=== Production Smoke Test ===");
  for (const c of checks) {
    const icon = c.status === "PASS" ? "✓" : c.status === "WARN" ? "▲" : "✗";
    console.log(`${icon} [${c.status}] ${c.name}: ${c.detail}${c.action ? `  → ${c.action}` : ""}`);
  }
  const fails = checks.filter(c => c.status === "FAIL").length;
  const warns = checks.filter(c => c.status === "WARN").length;
  console.log(`\n${checks.length} checks — ${fails} fail, ${warns} warn`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Smoke test crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
