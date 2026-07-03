import { NextRequest, NextResponse } from "next/server";
import { createOperatorProfile } from "@/src/services/operatorProfiles";
import { friendlyOperatorError } from "@/src/lib/operatorErrors";

export const dynamic = "force-dynamic";

// POST /api/dashboard/operators/create — create a new operator profile.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      username?: string;
      displayName?: string | null;
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
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
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
    const msg = friendlyOperatorError(err);
    console.error("[operators/create]", err);
    const status = (err instanceof Error && err.message.includes("already taken")) ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
