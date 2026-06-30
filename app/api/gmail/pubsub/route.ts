import { NextRequest, NextResponse } from "next/server";
import { processPubSubNotification } from "@/src/services/gmailIngestion";

// Google Pub/Sub push subscriptions require a 200 response within ~10 seconds.
// For slow ingestion, acknowledge first and process async. For V1, we process inline
// since the default timeout for a Pub/Sub push is sufficient for most cases.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Return 200 to Pub/Sub to avoid re-delivery of malformed messages.
    return NextResponse.json({ error: "Invalid JSON" }, { status: 200 });
  }

  try {
    const result = await processPubSubNotification(body);
    return NextResponse.json({ success: true, result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[pubsub] Unhandled error:", message);
    // Return 200 to avoid infinite Pub/Sub redelivery on bugs.
    // Real errors are logged to ingestion_errors.
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
