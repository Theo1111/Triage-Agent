import { NextRequest, NextResponse } from "next/server";
import { findByInboundEmailId } from "@/src/services/triageItems";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const inboundEmailId = req.nextUrl.searchParams.get("inboundEmailId");
  if (!inboundEmailId?.trim()) {
    return NextResponse.json(
      { error: "Missing required query param: inboundEmailId" },
      { status: 400 }
    );
  }

  try {
    const triageItem = await findByInboundEmailId(inboundEmailId);

    if (!triageItem) {
      return NextResponse.json(
        { error: `No triage item found for email ${inboundEmailId}` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, triageItem });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch triage item", details: message }, { status: 500 });
  }
}
