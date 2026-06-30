import { NextRequest, NextResponse } from "next/server";
import { assignTriageItem } from "@/src/services/triageItems";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { triageItemId, owner } = (body ?? {}) as Record<string, unknown>;
  if (typeof triageItemId !== "string" || !triageItemId.trim()) {
    return NextResponse.json({ error: "Missing required field: triageItemId (string)" }, { status: 400 });
  }
  if (typeof owner !== "string" || !owner.trim()) {
    return NextResponse.json({ error: "Missing required field: owner (string)" }, { status: 400 });
  }

  try {
    const triageItem = await assignTriageItem(triageItemId, owner.trim());
    return NextResponse.json({ success: true, triageItem });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Cannot assign")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to assign triage item", details: message }, { status: 500 });
  }
}
