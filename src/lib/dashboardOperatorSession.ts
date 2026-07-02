import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getOperatorProfileById, type OperatorProfilePublic } from "@/src/services/operatorProfiles";

const COOKIE_NAME    = "dash_op_sess";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function getSecret(): string {
  const s = process.env.DASHBOARD_OPERATOR_SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      console.error("[dashboard-session] DASHBOARD_OPERATOR_SESSION_SECRET is not set in production!");
    }
    return "dev-only-insecure-default";
  }
  return s;
}

// HMAC-sign the operator ID so clients cannot forge session cookies.
function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

function verifySignature(value: string, sig: string): boolean {
  try {
    const expected = Buffer.from(sign(value), "hex");
    const actual   = Buffer.from(sig, "hex");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ── Cookie encode / decode ────────────────────────────────────────────────────

export function encodeCookie(operatorId: string): string {
  return `${operatorId}.${sign(operatorId)}`;
}

export function decodeCookie(raw: string): string | null {
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const id  = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!id || !verifySignature(id, sig)) return null;
  return id;
}

// ── Set / clear helpers ───────────────────────────────────────────────────────

export function setOperatorSessionCookie(res: NextResponse, operatorId: string): void {
  res.cookies.set(COOKIE_NAME, encodeCookie(operatorId), {
    httpOnly: true,
    sameSite: "lax",
    secure:   process.env.NODE_ENV === "production",
    path:     "/",
    maxAge:   COOKIE_MAX_AGE,
  });
}

export function clearOperatorSessionCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure:   process.env.NODE_ENV === "production",
    path:     "/",
    maxAge:   0,
  });
}

// ── Resolve active operator from an inbound request ───────────────────────────

export async function getOperatorFromRequest(
  req: NextRequest
): Promise<OperatorProfilePublic | null> {
  const raw = req.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const id = decodeCookie(raw);
  if (!id) return null;

  return getOperatorProfileById(id);
}
