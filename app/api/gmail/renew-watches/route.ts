import { NextRequest, NextResponse } from "next/server";
import { renewWatchesDueSoon } from "@/src/services/gmailWatch";
import { env } from "@/src/config/env";

export const dynamic = "force-dynamic";

// POST /api/gmail/renew-watches
// Manual trigger for selective watch renewal. Requires CRON_SECRET if set.
// Prefer /api/cron/renew-gmail-watches for automated cron use.

export async function POST(req: NextRequest) {
  const cronSecret = env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const summary = await renewWatchesDueSoon();
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[renew-watches] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
