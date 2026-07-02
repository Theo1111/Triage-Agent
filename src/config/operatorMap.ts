// Canonical operator identity. Maps all known aliases (dashboard names, Slack
// usernames, Slack user IDs, emails) to a stable canonical ID stored in the DB.
// Add entries here when a new operator joins or uses a different identifier.

const CANONICAL: Record<string, string> = {
  // Theo Blumberg — all known aliases resolve to "tblumberg"
  "tblumberg":              "tblumberg",
  "theodore.blumberg":      "tblumberg",
  "theo":                   "tblumberg",
  "theodore":               "tblumberg",
  "theodore blumberg":      "tblumberg",
  "tblumberg@grata.life":   "tblumberg",
  "u08qrua4s6s":            "tblumberg", // Theo's Slack member ID
};

export function canonicalOperator(raw: string | null | undefined): string {
  if (!raw) return "";
  return CANONICAL[raw.toLowerCase()] ?? raw.toLowerCase();
}
