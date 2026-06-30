import type { GmailMessageHeader, ParsedEmailHeaders } from "@/src/types/gmail";

// Gmail headers come as an array of {name, value} — build a lookup map (case-insensitive).
export function buildHeaderMap(headers: GmailMessageHeader[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    map[h.name.toLowerCase()] = h.value;
  }
  return map;
}

// Parse a raw RFC 2822 "From" value like:
//   "Jane Doe <jane@example.com>" → { name: "Jane Doe", email: "jane@example.com" }
//   "jane@example.com" → { name: "", email: "jane@example.com" }
export function parseAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1].replace(/^"|"$/g, "").trim(), email: match[2].trim().toLowerCase() };
  }
  // Plain email with no display name.
  const emailOnly = raw.trim().toLowerCase();
  return { name: "", email: emailOnly };
}

// Parse a comma-separated address header into an array of email strings.
function parseAddressList(raw: string): string[] {
  // Naive split — handles simple cases. Quoted commas are rare in To/CC.
  return raw
    .split(",")
    .map((s) => parseAddress(s.trim()).email)
    .filter(Boolean);
}

export function parseHeaders(headers: GmailMessageHeader[]): ParsedEmailHeaders {
  const map = buildHeaderMap(headers);

  const fromRaw = map["from"] ?? "";
  const { name: senderName, email: senderEmail } = parseAddress(fromRaw);

  const dateRaw = map["date"] ?? "";
  const sentAt = dateRaw ? tryParseDate(dateRaw) : null;

  // "Received" header can have a date after a semicolon — use the last one as received time.
  const receivedRaw = map["received"] ?? "";
  const receivedAt = extractReceivedDate(receivedRaw) ?? sentAt;

  return {
    from: fromRaw,
    to: parseAddressList(map["to"] ?? ""),
    cc: parseAddressList(map["cc"] ?? ""),
    bcc: parseAddressList(map["bcc"] ?? ""),
    replyTo: map["reply-to"] ?? "",
    subject: map["subject"] ?? "",
    date: dateRaw,
    messageId: map["message-id"] ?? "",
    receivedAt,
    sentAt,
    senderEmail,
    senderName,
  };
}

function tryParseDate(raw: string): Date | null {
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function extractReceivedDate(receivedHeader: string): Date | null {
  // "Received" ends with "; <date>" — grab everything after the last semicolon.
  const idx = receivedHeader.lastIndexOf(";");
  if (idx === -1) return null;
  return tryParseDate(receivedHeader.slice(idx + 1).trim());
}
