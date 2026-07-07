// Signup policy for dashboard operator profiles.
//
// Only Grata employees may create dashboard profiles. The allowed domain list
// defaults to "grata.life" and can be overridden with the env var
// DASHBOARD_ALLOWED_SIGNUP_DOMAINS (comma-separated, e.g. "grata.life,speer.io").

const DEFAULT_ALLOWED_DOMAINS = ["grata.life"];

// Strict single-address email shape: local@domain, no spaces, one @,
// domain must have at least one dot and a 2+ char TLD.
const EMAIL_RE = /^[a-z0-9](?:[a-z0-9._%+-]{0,63})@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function getAllowedSignupDomains(): string[] {
  const raw = process.env.DASHBOARD_ALLOWED_SIGNUP_DOMAINS;
  if (!raw?.trim()) return DEFAULT_ALLOWED_DOMAINS;
  const domains = raw
    .split(",")
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
  return domains.length > 0 ? domains : DEFAULT_ALLOWED_DOMAINS;
}

// Trim + lowercase. Always store and compare the normalized form.
export function normalizeSignupEmail(email: string): string {
  return email.trim().toLowerCase();
}

// True only for a well-formed email whose domain EXACTLY matches an allowed
// domain. "fake@grata.life.evil.com" fails because the domain is
// "grata.life.evil.com", not "grata.life".
export function isAllowedDashboardSignupEmail(email: string): boolean {
  const normalized = normalizeSignupEmail(email);
  if (!EMAIL_RE.test(normalized)) return false;

  const at = normalized.lastIndexOf("@");
  const domain = normalized.slice(at + 1);
  return getAllowedSignupDomains().includes(domain);
}
