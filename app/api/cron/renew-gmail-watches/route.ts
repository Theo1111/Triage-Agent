import { NextRequest, NextResponse } from "next/server";
import { renewWatchesDueSoon } from "@/src/services/gmailWatch";
import { env } from "@/src/config/env";

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
  const cronSecret = env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token !== cronSecret) {
      console.warn("[cron/renew-gmail-watches] Unauthorized request — bad or missing CRON_SECRET");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("[cron/renew-gmail-watches] CRON_SECRET not set — allowing unauthenticated request (dev only)");
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
