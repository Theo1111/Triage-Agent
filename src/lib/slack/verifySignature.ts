import { createHmac, timingSafeEqual } from "crypto";

// Verifies that a Slack request came from Slack using HMAC-SHA256.
// Spec: https://api.slack.com/authentication/verifying-requests-from-slack
export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string
): boolean {
  // Reject requests older than 5 minutes to prevent replay attacks.
  const ts = parseInt(timestamp, 10);
  if (!timestamp || isNaN(ts)) return false;

  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (ts < fiveMinutesAgo) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", signingSecret)
    .update(sigBase, "utf8")
    .digest("hex")}`;

  // timingSafeEqual requires same-length buffers; mismatched length = invalid.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
