import type { GmailMessagePart } from "@/src/types/gmail";

export interface ParsedEmailBody {
  textPlain: string | null;
  textHtml: string | null;
}

// Recursively walk a MIME part tree and collect plain text and HTML bodies.
export function extractEmailBodies(part: GmailMessagePart): ParsedEmailBody {
  const result: ParsedEmailBody = { textPlain: null, textHtml: null };
  collectBodies(part, result);
  return result;
}

function collectBodies(part: GmailMessagePart, result: ParsedEmailBody): void {
  const mimeType = (part.mimeType ?? "").toLowerCase();

  if (mimeType === "text/plain" && part.body?.data) {
    result.textPlain = decodeBase64url(part.body.data);
    return;
  }

  if (mimeType === "text/html" && part.body?.data) {
    result.textHtml = decodeBase64url(part.body.data);
    return;
  }

  // Walk nested parts (multipart/* containers).
  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) {
      collectBodies(child, result);
    }
  }
}

export function decodeBase64url(encoded: string): string {
  // Gmail uses URL-safe base64 (- instead of +, _ instead of /).
  const standard = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(standard, "base64").toString("utf-8");
}
