import { NextRequest, NextResponse } from "next/server";
import { runAutoTriagePipeline } from "@/src/services/autoTriagePipeline";

export const dynamic = "force-dynamic";

// Dev-only: manually trigger the full classify → triage → Slack pipeline for a stored email.
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

  const { inboundEmailId } = body as Record<string, unknown>;
  if (!inboundEmailId || typeof inboundEmailId !== "string") {
    return NextResponse.json({ error: "inboundEmailId (string) is required" }, { status: 400 });
  }

  const result = await runAutoTriagePipeline(inboundEmailId);
  return NextResponse.json(result);
}
