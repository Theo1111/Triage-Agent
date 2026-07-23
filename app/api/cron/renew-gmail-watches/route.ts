import { NextRequest, NextResponse } from "next/server";
import { renewWatchesDueSoon } from "@/src/services/gmailWatch";
import { env } from "@/src/config/env";
import { verifyBearerSecret } from "@/src/lib/secrets";
import { logger } from "@/src/lib/log";

export const dynamic = "force-dynamic";

// GET /api/cron/renew-gmail-watches
// Triggered daily by Vercel Cron (see vercel.json). Also callable manually for testing.
//
// Protection: requires Authorization: Bearer <CRON_SECRET> header.
// If CRON_SECRET is unset (local dev), the request is allowed through with a warning.
//
// Only renews watches expiring within 24h, already expired, or in a non-active status.
// Skips inboxes with oauth_invalid status — they need manual OAuth reconnect.

export async function GET(req: NextRequest) {
  // Fail closed: unset CRON_SECRET in production is a config error (500).
  const auth = verifyBearerSecret(req.headers.get("authorization"), env.CRON_SECRET, {
    name: "CRON_SECRET",
  });
  if (!auth.ok) {
    logger.warn("cron.auth_failed", { stage: "renew-gmail-watches", outcome: String(auth.status) });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.error) {
    logger.warn("cron.auth_dev_bypass", { stage: "renew-gmail-watches" });
  }

  try {
    console.log("[cron/renew-gmail-watches] Starting selective watch renewal");
    const summary = await renewWatchesDueSoon();

    const { checked, renewed, failed, oauthInvalid = 0 } = summary;
    const message = checked === 0
      ? "No watches due for renewal."
      : `Checked ${checked}, renewed ${renewed}, failed ${failed}` +
        (oauthInvalid > 0 ? `, ${oauthInvalid} need OAuth reconnect` : "") + ".";

    console.log(`[cron/renew-gmail-watches] Done: ${message}`);

    return NextResponse.json({
      ok: failed === 0,
      summary: message,
      checked,
      renewed,
      failed,
      oauthInvalid,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/renew-gmail-watches] Unhandled error:", err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
