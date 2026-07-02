import { NextRequest, NextResponse } from "next/server";
import { createOperatorProfile } from "@/src/services/operatorProfiles";

export const dynamic = "force-dynamic";

// POST /api/dashboard/operators/create — create a new operator profile.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      username?: string;
      displayName?: string;
      password?: string;
      confirmPassword?: string;
    };
    const { username, displayName, password, confirmPassword } = body;

    if (!username?.trim()) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ error: "password is required" }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
    }

    const profile = await createOperatorProfile({
      username: username.trim(),
      displayName: displayName?.trim() || null,
      password,
    });

    return NextResponse.json({ profile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
