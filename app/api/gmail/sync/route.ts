import { NextResponse } from "next/server";
import { manualSyncAllInboxes } from "@/src/services/gmailIngestion";

export const dynamic = "force-dynamic";

// POST /api/gmail/sync
// Renews all Gmail watches and processes history since each inbox's last
// known historyId. Called by the "Refresh Emails" button in the dashboard.
//
// This does NOT require operator authentication — it uses server-side Gmail
// OAuth credentials stored in oauth_accounts, not an operator session cookie.
// Ingestion is a backend job; it runs whether or not a user is logged in.
//
// Example response:
// {
//   "ok": true,
//   "summary": "2 emails fetched for 1 inbox",
//   "result": { "totalNewStored": 2, "watchesRenewed": 1, ... }
// }

export async function POST() {
  try {
    console.log("[/api/gmail/sync] Manual sync triggered from dashboard");
    const result = await manualSyncAllInboxes();

    const summary = result.status === "no_inboxes"
      ? "No active inboxes configured."
      : result.inboxResults.some(r => r.historyExpired)
        ? `Watch${result.watchesRenewed > 1 ? "es" : ""} renewed. ` +
          `History was expired — ${result.totalNewStored} email${result.totalNewStored !== 1 ? "s" : ""} fetched. ` +
          `Future emails will now arrive normally.`
        : `${result.totalNewStored} new email${result.totalNewStored !== 1 ? "s" : ""} fetched` +
          (result.totalDuplicatesSkipped > 0 ? `, ${result.totalDuplicatesSkipped} already stored` : "") +
          `.`;

    return NextResponse.json({ ok: result.status !== "failed", summary, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/gmail/sync] Unhandled error:", err);
    return NextResponse.json(
      { ok: false, summary: "Sync failed — check server logs.", error: msg },
      { status: 500 }
    );
  }
}
