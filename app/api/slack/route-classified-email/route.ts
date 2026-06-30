import { NextRequest, NextResponse } from "next/server";
import { routeClassifiedEmail } from "@/src/services/slackAlerts";

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

  if (
    typeof body !== "object" ||
    body === null ||
    !("inboundEmailId" in body) ||
    typeof (body as Record<string, unknown>).inboundEmailId !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing required field: inboundEmailId (string)" },
      { status: 400 }
    );
  }

  const { inboundEmailId } = body as { inboundEmailId: string };

  if (!inboundEmailId.trim()) {
    return NextResponse.json({ error: "inboundEmailId cannot be empty" }, { status: 400 });
  }

  console.log(`[route-classified-email] Routing email to Slack: ${inboundEmailId}`);

  try {
    const result = await routeClassifiedEmail(inboundEmailId);

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[route-classified-email] Error for ${inboundEmailId}:`, message);

    if (message.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("SLACK_ESCALATION_WEBHOOK_URL")) {
      return NextResponse.json(
        { error: "Slack not configured. Set SLACK_ESCALATION_WEBHOOK_URL in .env.local.", details: message },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: "Routing failed", details: message }, { status: 500 });
  }
}
