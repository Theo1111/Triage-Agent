// Cleans a raw email body_text for use in AI classification, Slack summaries,
// and UI display. Removes Exclaimer/tracking URLs, mailto:/tel: link markup,
// cid: image placeholders, and email signatures.
//
// Does NOT strip quoted thread history — call extractNewReplyBody() for that.
// DB storage is always the unmodified body_text; cleaning happens at runtime.

// ─── Signature stripping ─────────────────────────────────────────────────────

const SIGN_OFF_RE =
  /^(best( regards| wishes)?|kind regards|sincerely|regards|cheers|warm(est)? regards|yours (truly|faithfully)|best[,.]?|warmly|thank(s| you) and regards)[,.]?\s*$/i;

function looksLikeSignatureLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (SIGN_OFF_RE.test(t)) return true;
  if (/\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/.test(t)) return true;
  if (/\b[\w.%+-]+@[\w.-]+\.[a-zA-Z]{2,}\b/.test(t)) return true;
  if (/https?:\/\/|www\./i.test(t)) return true;
  if (/mailto:/i.test(t)) return true;
  if (/[|•·]/.test(t)) return true;
  if (/\b(confidential|disclaimer|privileged|intended recipient|do not (share|distribute|forward))/i.test(t)) return true;
  return false;
}

function stripSignature(lines: string[]): string[] {
  // Standard markers
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "--" || t === "—" || t === "___") return lines.slice(0, i);
    if (/^get (outlook|mail) for (ios|android|iphone|ipad)/i.test(t)) return lines.slice(0, i);
    if (/^sent from my (iphone|ipad|android|samsung|pixel|mobile|blackberry)/i.test(t)) return lines.slice(0, i);
  }

  // Backward-scanning heuristic
  let end = lines.length;

  while (end > 1) {
    let blockEnd = end;
    while (blockEnd > 0 && !lines[blockEnd - 1].trim()) blockEnd--;
    if (blockEnd === 0) break;

    let blockStart = blockEnd - 1;
    while (blockStart > 0 && lines[blockStart - 1].trim()) blockStart--;

    const blockLines = lines.slice(blockStart, blockEnd);
    const nonBlank = blockLines.filter(l => l.trim());

    if (nonBlank.length >= 1 && SIGN_OFF_RE.test(nonBlank[0].trim())) {
      end = blockStart;
      while (end > 0 && !lines[end - 1].trim()) end--;
      continue;
    }

    const sigCount = nonBlank.filter(l => looksLikeSignatureLine(l)).length;
    if (nonBlank.length >= 2 && sigCount >= 2) {
      end = blockStart;
      while (end > 0 && !lines[end - 1].trim()) end--;
      continue;
    }

    break;
  }

  return lines.slice(0, end);
}

// ─── Main cleaner ─────────────────────────────────────────────────────────────

export function cleanEmailBodyForTriage(rawBody: string): string {
  if (!rawBody.trim()) return "";

  let text = rawBody;

  // Remove cid: image placeholders produced by HTML-to-text conversion.
  text = text.replace(/\[cid:[^\]]+\]/gi, "");
  text = text.replace(/<cid:[^>]+>/gi, "");

  // Remove mailto: link markup — keeps the preceding display text.
  // Input:  "email@example.com<mailto:email@example.com>"
  // Output: "email@example.com"
  text = text.replace(/<mailto:[^>]+>/gi, "");

  // Remove tel: link markup — keeps the preceding display text.
  // Input:  "c: (602) 853-3329<tel:+16028533329>"
  // Output: "c: (602) 853-3329"
  text = text.replace(/<tel:[^>]+>/gi, "");

  // Remove entire lines that are solely Exclaimer / tracking service URLs.
  // These appear in signatures and footers as invisible tracking pixels transcribed
  // by Gmail's HTML-to-text renderer.
  const lines = text.split("\n").filter(line => {
    const t = line.trim();
    if (!t) return true;
    if (/^https?:\/\/[^\s]*exclaimer[^\s]*/i.test(t)) return false;
    if (/^https?:\/\/[^\s]*\.exclaimer\.net/i.test(t)) return false;
    return true;
  });

  const stripped = stripSignature(lines);

  return stripped.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
