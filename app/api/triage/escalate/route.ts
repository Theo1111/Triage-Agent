import { NextRequest, NextResponse } from "next/server";
import { escalateTriageItem } from "@/src/services/triageItems";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { triageItemId } = (body ?? {}) as Record<string, unknown>;
  if (typeof triageItemId !== "string" || !triageItemId.trim()) {
    return NextResponse.json({ error: "Missing required field: triageItemId (string)" }, { status: 400 });
  }

  try {
    const triageItem = await escalateTriageItem(triageItemId);
    return NextResponse.json({ success: true, triageItem });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Cannot escalate")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to escalate triage item", details: message }, { status: 500 });
  }
}
