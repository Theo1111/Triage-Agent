import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { verifyBearerSecret } from "@/src/lib/secrets";
import { runHealthAlerts } from "@/src/services/healthAlerts";
import { logger, summarizeError } from "@/src/lib/log";

export const dynamic = "force-dynamic";

// GET /api/cron/health-alerts
// Runs on a schedule (NOT on every health poll) so alerts are deduped + cooled
// down. No-op unless SLACK_ALERT_CHANNEL_ID + SLACK_BOT_TOKEN are configured.
export async function GET(req: NextRequest) {
  const auth = verifyBearerSecret(req.headers.get("authorization"), env.CRON_SECRET, { name: "CRON_SECRET" });
  if (!auth.ok) {
    logger.warn("cron.auth_failed", { stage: "health-alerts", outcome: String(auth.status) });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const result = await runHealthAlerts();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error("cron.health-alerts.failed", { stage: "health-alerts", outcome: "error", error: summarizeError(err) });
    return NextResponse.json({ ok: false, error: "Health alert run failed" }, { status: 500 });
  }
}
