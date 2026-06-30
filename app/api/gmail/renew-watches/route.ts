import { NextResponse } from "next/server";
import { renewActiveWatches } from "@/src/services/gmailWatch";

export async function POST() {
  try {
    const summary = await renewActiveWatches();
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[renew-watches] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
