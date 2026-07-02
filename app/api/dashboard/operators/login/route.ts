import { NextRequest, NextResponse } from "next/server";
import { verifyOperatorPassword } from "@/src/services/operatorProfiles";
import { setOperatorSessionCookie } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

// POST /api/dashboard/operators/login — verify credentials and set session cookie.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    const { username, password } = body;

    if (!username?.trim() || !password) {
      return NextResponse.json({ error: "username and password required" }, { status: 400 });
    }

    const profile = await verifyOperatorPassword(username.trim(), password);
    if (!profile) {
      // Intentionally vague — don't reveal whether username exists.
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    const res = NextResponse.json({ profile });
    setOperatorSessionCookie(res, profile.id);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
