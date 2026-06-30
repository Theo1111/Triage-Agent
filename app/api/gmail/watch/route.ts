import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { registerWatch } from "@/src/services/gmailWatch";

const bodySchema = z.object({
  emailAddress: z.string().email(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await registerWatch(parsed.data.emailAddress);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    historyId: result.historyId,
    expiration: result.expiration?.toISOString(),
  });
}
