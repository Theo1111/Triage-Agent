import { NextResponse } from "next/server";
import { clearOperatorSessionCookie } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

// POST /api/dashboard/operators/logout — clear the session cookie.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearOperatorSessionCookie(res);
  return res;
}
