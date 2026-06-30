import type { GmailMessagePart, GmailMessageHeader } from "@/src/types/gmail";

export interface AttachmentPart {
  attachmentId: string;
  filename: string;             // always set — generated for unnamed inline images
  mimeType: string;
  size: number;
  isInline: boolean;
  contentId: string | null;     // Content-ID value with angle brackets stripped
  contentDisposition: string | null; // raw Content-Disposition header value
}

export interface AttachmentScanStats {
  totalPartsScanned: number;
  traditionalFound: number;
  inlineFound: number;
}

export interface DetectAttachmentsResult {
  parts: AttachmentPart[];
  stats: AttachmentScanStats;
}

// Walk the full MIME part tree and collect every part that should be stored as an attachment.
// Captures:
//   1. Traditional paperclip attachments (body.attachmentId + filename)
//   2. Drag-and-drop attachments (same as above)
//   3. Inline pasted screenshots/images (body.attachmentId, image/* mime, no filename)
//   4. Any part with Content-Disposition: inline
//   5. Any part with a Content-ID / cid reference
//   6. Any part with a filename even if Content-Disposition is absent
export function detectAttachments(payload: GmailMessagePart): DetectAttachmentsResult {
  const parts: AttachmentPart[] = [];
  const stats: AttachmentScanStats = { totalPartsScanned: 0, traditionalFound: 0, inlineFound: 0 };
  collectParts(payload, parts, stats);
  return { parts, stats };
}

// --- helpers ---

function headerValue(headers: GmailMessageHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}

// Maps common image MIME types to file extensions for filename generation.
function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/heic": ".heic",
    "image/heif": ".heif",
  };
  return map[mimeType.toLowerCase()] ?? ".bin";
}

function collectParts(
  part: GmailMessagePart,
  results: AttachmentPart[],
  stats: AttachmentScanStats
): void {
  stats.totalPartsScanned++;

  const mime = (part.mimeType ?? "").toLowerCase();
  const attachmentId = part.body?.attachmentId;
  const headers = part.headers;

  const contentDisposition = headerValue(headers, "Content-Disposition");
  const contentId = headerValue(headers, "Content-ID");
  const dispositionLower = (contentDisposition ?? "").toLowerCase();

  // Always recurse into multipart containers before checking the part itself.
  if (mime.startsWith("multipart/")) {
    for (const child of part.parts ?? []) {
      collectParts(child, results, stats);
    }
    return;
  }

  // A part qualifies for attachment ingestion when it has a Gmail attachment ID
  // (meaning it's fetchable via the API) AND at least one of:
  //   - has a filename                            → traditional attachment or named inline
  //   - mimeType is image/*                       → pasted screenshot / embedded image
  //   - has a Content-ID header                   → CID reference used in HTML body
  //   - Content-Disposition is "attachment"       → explicit attachment marker
  //   - Content-Disposition is "inline"           → explicit inline marker
  //
  // The old condition was `attachmentId && filename` — this missed all unnamed inline images.
  const isImageMime = mime.startsWith("image/");
  const hasCid = !!contentId;
  const hasFilename = !!part.filename;
  const hasExplicitDisposition =
    dispositionLower.includes("attachment") || dispositionLower.includes("inline");

  const qualifies =
    !!attachmentId &&
    (hasFilename || isImageMime || hasCid || hasExplicitDisposition);

  if (!qualifies) {
    // Recurse in case this is a non-multipart container with nested parts (unusual but possible).
    for (const child of part.parts ?? []) {
      collectParts(child, results, stats);
    }
    return;
  }

  // Determine inline vs traditional:
  //   - Inline: has CID, or Content-Disposition says "inline", or is an image with no explicit
  //     "attachment" disposition (pasted screenshots arrive this way).
  const isInline =
    hasCid ||
    dispositionLower.includes("inline") ||
    (isImageMime && !dispositionLower.includes("attachment"));

  // Generate a filename when Gmail didn't supply one (typical for pasted screenshots).
  const filename =
    part.filename || `inline-image-${attachmentId}${mimeToExtension(mime)}`;

  results.push({
    attachmentId,
    filename,
    mimeType: mime || "application/octet-stream",
    size: part.body?.size ?? 0,
    isInline,
    // Strip surrounding angle brackets from Content-ID values like <unique@gmail.com>.
    contentId: contentId ? contentId.replace(/^<|>$/g, "") : null,
    contentDisposition,
  });

  if (isInline) {
    stats.inlineFound++;
  } else {
    stats.traditionalFound++;
  }
}

// Attempt to extract plain text from an attachment's raw bytes.
// Returns null for unsupported types — caller marks extraction as "unsupported".
export function extractTextFromAttachment(
  mimeType: string,
  data: Buffer
): { text: string | null; supported: boolean } {
  const mime = mimeType.toLowerCase();
  if (mime === "text/plain" || mime === "text/csv" || mime === "text/markdown") {
    return { text: data.toString("utf-8"), supported: true };
  }
  // PDF and docx extraction requires extra deps (pdf-parse, mammoth).
  // Mark as unsupported rather than pulling in heavy parsers for V1.
  return { text: null, supported: false };
}
