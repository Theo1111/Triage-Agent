import { NextRequest, NextResponse } from "next/server";
import { verifyOperatorPassword } from "@/src/services/operatorProfiles";
import { setOperatorSessionCookie } from "@/src/lib/dashboardOperatorSession";
import { friendlyOperatorError } from "@/src/lib/operatorErrors";

export const dynamic = "force-dynamic";

// POST /api/dashboard/operators/login — verify credentials and set session cookie.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    const { username, password } = body;

    if (!username?.trim()) {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const profile = await verifyOperatorPassword(username.trim(), password);
    if (!profile) {
      // Intentionally vague — don't reveal whether the username exists.
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    const res = NextResponse.json({ profile });
    setOperatorSessionCookie(res, profile.id);
    return res;
  } catch (err) {
    const msg = friendlyOperatorError(err);
    console.error("[operators/login]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
