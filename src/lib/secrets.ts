import { createHash, timingSafeEqual } from "node:crypto";

// Shared, fail-closed secret verification for cron + Paperclip endpoints.
//
// Production posture:
//   - A required secret that is UNSET in production is an explicit configuration
//     error (500) — never a silent allow.
//   - In non-production, an unset secret is allowed with a warning (dev ergonomics).
//   - Comparison is constant-time (SHA-256 + timingSafeEqual) to avoid timing leaks.

export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  // Equal-length digests, so timingSafeEqual is safe to call directly.
  return timingSafeEqual(ha, hb);
}

export function bearerToken(authHeader: string | null | undefined): string {
  const h = authHeader ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export interface SecretVerification {
  ok: boolean;
  status: number; // 200 ok, 401 bad/missing token, 500 misconfigured
  error?: string;
}

export interface VerifyOptions {
  name: string; // e.g. "CRON_SECRET"
  isProduction?: boolean; // defaults to NODE_ENV === "production"
}

// Verify an incoming Bearer token against a configured secret.
export function verifyBearerSecret(
  authHeader: string | null | undefined,
  secret: string | undefined | null,
  opts: VerifyOptions
): SecretVerification {
  const isProd = opts.isProduction ?? process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      return {
        ok: false,
        status: 500,
        error: `${opts.name} is not configured. Set it in the environment before enabling this endpoint in production.`,
      };
    }
    // Dev only — allow but the caller should warn.
    return { ok: true, status: 200, error: `${opts.name} not set — allowing unauthenticated request (dev only).` };
  }

  const token = bearerToken(authHeader);
  if (!token || !constantTimeEqual(token, secret)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true, status: 200 };
}
