import { NextRequest, NextResponse } from "next/server";
import { connectGoogleAccount } from "@/src/services/oauthAccounts";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.json({ error: `OAuth error: ${error}` }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  try {
    const { inbox, account } = await connectGoogleAccount(code);
    return NextResponse.json({
      success: true,
      emailAddress: inbox.email_address,
      inboxId: inbox.id,
      accountId: account.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[auth/callback] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
