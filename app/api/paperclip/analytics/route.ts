import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { verifyBearerSecret } from "@/src/lib/secrets";
import { getPaperclipAnalytics } from "@/src/services/paperclipAnalytics";
import { logger, summarizeError } from "@/src/lib/log";

export const dynamic = "force-dynamic";

// GET /api/paperclip/analytics?days=7&runId=...
// Safe aggregate analytics for Paperclip. Same fail-closed auth as the heartbeat.
// Returns only non-sensitive counts/rates — never bodies, senders, tokens, or
// raw model output.
export async function GET(req: NextRequest) {
  const auth = verifyBearerSecret(
    req.headers.get("authorization"),
    env.PAPERCLIP_HEARTBEAT_SECRET,
    { name: "PAPERCLIP_HEARTBEAT_SECRET" }
  );
  if (!auth.ok) {
    logger.warn("paperclip.analytics.auth_failed", { outcome: String(auth.status) });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const paperclipRunId = req.nextUrl.searchParams.get("runId");
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "7");

  try {
    const analytics = await getPaperclipAnalytics(daysParam);
    logger.info("paperclip.analytics.served", {
      paperclipRunId,
      stage: "analytics",
      outcome: "ok",
      windowDays: analytics.windowDays,
    });
    return NextResponse.json({ ok: true, paperclipRunId, analytics });
  } catch (err) {
    logger.error("paperclip.analytics.failed", {
      paperclipRunId,
      stage: "analytics",
      outcome: "error",
      error: summarizeError(err),
    });
    return NextResponse.json({ ok: false, error: "Analytics query failed" }, { status: 500 });
  }
}
