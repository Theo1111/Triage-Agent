import type { InboundEmail, TriageItem } from "@/src/types/database";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import * as triageItemsRepo from "@/src/repositories/triageItemsRepository";
import { getInternalDomains } from "@/src/config/env";

// ─── Constants ────────────────────────────────────────────────────────────────

const GRATA_DOMAIN = "grata.life";

// Max length of the stripped new-reply body before we stop auto-suppressing
// and let the AI decide (internal sender only).
const MAX_SUPPRESS_CHARS = 500;

// Reply subject prefixes across email clients.
const REPLY_SUBJECT_RE = /^(re|fwd|fw|aw|antw|sv|rv|tr)\s*:\s*/i;

// ─── Quote stripping ──────────────────────────────────────────────────────────
// Removes quoted thread history from a reply body, leaving only the new text.

// Detect the line index where the quoted section begins.
function findQuoteStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();

    // "On [date], [name] wrote:" — Gmail / Apple Mail standard
    if (/^On .{10,} wrote:?\s*$/i.test(t)) return i;

    // Gmail sometimes splits "On ... wrote:" across two lines
    if (/^On .{10,}$/.test(t) && i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (/wrote:?\s*$/i.test(next)) return i;
    }

    // Outlook "From: X  Sent: Y  To: Z  Subject: W" block
    if (/^From:\s+\S/i.test(t)) {
      const lookahead = lines.slice(i, i + 5).join(" ");
      if (/Sent:\s/i.test(lookahead) && /Subject:\s/i.test(lookahead)) return i;
    }

    // Horizontal separators: "--- Original Message ---", "________", "━━━━━━"
    if (/^[-_—━=]{3,}\s*(original message|forwarded|begin forwarded)?[-_—━=]*\s*$/i.test(t)) return i;

    // A > quote line preceded by a blank line (start of quoted block)
    if (t.startsWith(">") && (i === 0 || lines[i - 1].trim() === "")) return i;

    // Two consecutive > lines = start of a block even without blank separator
    if (t.startsWith(">") && i + 1 < lines.length && lines[i + 1].trimStart().startsWith(">")) return i;
  }
  return -1;
}

// Standard email sign-off phrases that begin a signature block.
const SIGN_OFF_RE =
  /^(best( regards| wishes)?|kind regards|sincerely|regards|cheers|warm(est)? regards|yours (truly|faithfully)|best[,.]?|warmly|thank(s| you) and regards)[,.]?\s*$/i;

// Individual lines that are typical inside a signature block.
function looksLikeSignatureLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (SIGN_OFF_RE.test(t)) return true;
  // Phone numbers (North American + international)
  if (/\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/.test(t)) return true;
  // Email addresses
  if (/\b[\w.%+-]+@[\w.-]+\.[a-zA-Z]{2,}\b/.test(t)) return true;
  // URLs
  if (/https?:\/\/|www\./i.test(t)) return true;
  // mailto: links (common in HTML-to-text conversion)
  if (/mailto:/i.test(t)) return true;
  // Pipe / bullet separators common in signatures ("Name | Title | Company")
  if (/[|•·]/.test(t)) return true;
  // Legal disclaimers
  if (/\b(confidential|disclaimer|privileged|intended recipient|do not (share|distribute|forward))/i.test(t)) return true;
  return false;
}

// Remove email signature block.
//
// Handles:
//   1. Standard markers: "--", "—", "___", mobile app signatures.
//   2. Heuristic backward-scan: trailing blocks separated by a blank line that
//      (a) start with a sign-off phrase ("Regards,", "Best,", …), or
//      (b) contain ≥ 2 non-blank lines and ≥ 2 of them look like contact info
//          (phone, email, URL, mailto, pipe-separated, disclaimer).
//
// Scans from the bottom up so multi-paragraph messages aren't over-stripped.
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
    // Move past trailing blank lines to find where this last block ends
    let blockEnd = end;
    while (blockEnd > 0 && !lines[blockEnd - 1].trim()) blockEnd--;
    if (blockEnd === 0) break;

    // Find the start of this block (back to the nearest blank line or beginning)
    let blockStart = blockEnd - 1;
    while (blockStart > 0 && lines[blockStart - 1].trim()) blockStart--;

    const blockLines = lines.slice(blockStart, blockEnd);
    const nonBlank = blockLines.filter(l => l.trim());

    // Block starts with a sign-off phrase → definitely a signature
    if (nonBlank.length >= 1 && SIGN_OFF_RE.test(nonBlank[0].trim())) {
      end = blockStart;
      while (end > 0 && !lines[end - 1].trim()) end--;
      continue;
    }

    // Block has ≥ 2 non-blank lines and ≥ 2 of them look like contact info
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

// Extract only the newly written reply text, stripping quoted history and signatures.
// This is the body we send to the AI for thread replies so it classifies the reply,
// not the original issue that may be quoted in the thread.
export function extractNewReplyBody(rawBody: string): string {
  if (!rawBody.trim()) return "";

  const lines = rawBody.split("\n");

  // Cut at the first quoted-section marker
  const quoteStart = findQuoteStart(lines);
  const beforeQuote = quoteStart >= 0 ? lines.slice(0, quoteStart) : lines;

  // Filter any stray "> " lines that appeared before the main quoted block
  const withoutQuoteLines = beforeQuote.filter(l => !l.trimStart().startsWith(">"));

  // Remove signature
  const withoutSig = stripSignature(withoutQuoteLines);

  return withoutSig.join("\n").trim();
}

// ─── Sender classification ────────────────────────────────────────────────────

export function isInternalSenderEmail(senderEmail: string): boolean {
  const domain = senderEmail.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return false;
  if (domain === GRATA_DOMAIN) return true;
  return getInternalDomains().includes(domain);
}

// ─── Signal matching ──────────────────────────────────────────────────────────

// Signals indicating the reply is a genuine escalation. Block suppression even for
// internal senders when these appear in the stripped new reply body.
const ESCALATION_SIGNALS: RegExp[] = [
  /still (not fixed|broken|happening|locked out|down|offline|unresolved|blocked)/i,
  /still (no (response|update|solution|fix))/i,
  /has(n'?t| not) (been fixed|been resolved|worked)/i,
  /getting worse/i,
  /now affecting (all|multiple|every)/i,
  /need (engineering|ops|someone) (to look|to check|to investigate|now|today|asap|urgently)/i,
  /customer (is|are) (upset|angry|threatening|cancell)/i,
  /threatening to cancel/i,
  /no one has (responded|replied|looked|followed up)/i,
  /\d+ hours? (later|and still)/i,
  /escalat/i,
  /all (residents?|tenants?|occupants?)/i,
  /everyone (is|can'?t|cannot)/i,
  /blocking (launch|deploy|release)/i,
  /production (is )?down/i,
];

// Classic acknowledgement patterns.
const ACK_PATTERNS: RegExp[] = [
  /^thank(s| you) for (flagging|reaching out|letting us know|the (heads[ -]?up|update|report))/i,
  /thank(s| you)[,!.]?\s*(we|i|our team)\s*(will|are|can)\s+(investigate|look|follow up|check|get back|take a look|be in touch|update)/i,
  /^(received|acknowledged|noted|got it|understood|confirmed|on it|will do|sounds good)[,!.]?\s*$/i,
  /^(we|i)'?ll?\s+(look|investigate|follow up|check|get back|update|review|take care|pass this on|loop in)/i,
  /^(looking into|checking on|investigating|following up|looping in|cc['']?ing|copying)/i,
  /^(we are|we're|i am|i'm)\s+(looking|checking|investigating|following up|on it)/i,
  /^(thanks|thank you)[,!.]?\s*$/i,
  /^(noted|understood|acknowledged|received|confirmed)[,!.]?\s*$/i,
  /^will (investigate|look into|follow up|check|get back|update|handle)[,!.]?\s*$/i,
  /^(no problem|sure|of course|absolutely)[,!.]?\s*$/i,
  /^(sounds good|got it|perfect|great)[,!.]?\s*$/i,
];

// Internal coordination patterns — routing, diagnosis, team hand-off.
// These cover cases like "Must be an IP change again - copying @Ved and @Amaan to support".
const INTERNAL_COORDINATION_PATTERNS: RegExp[] = [
  // Technical diagnosis hand-off
  /must be (a|an) /i,
  /looks? like (a|an) /i,
  /think(ing)? this (is|might be|could be)/i,
  /probably (a|an) /i,
  /likely (a|an) /i,
  /this (is |might be |could be )(a|an) /i,

  // Routing people into the thread
  /(copying|cc[''-]?ing|looping in|adding|paging|tagging|bringing in) @?\w/i,
  /cc[''-]?d @?\w/i,
  /loop(ing|ed) in/i,

  // Hand-off verbs
  /^(moving|forwarding|escalating|routing|handing off) (this )?to \w/i,
  /^(reached out|pinged|contacted|emailed|messaged) (to )?\w/i,
  /(will |going to )?(reach out|ping|contact|message|email) (to )?\w/i,
  /^(asked|asking) \w+ to (look|check|investigate|handle|take a look)/i,

  // FYI / heads-up
  /^fyi[,!:.]?\s/i,
  /^(heads[ -]?up)[,!:.]?\s/i,
  /^(just (a )?)?fyi[,!.]?\s*$/i,

  // Simple follow-ups / checking in
  /^(following up|circling back|checking in)[,.]?\s/i,
  /^(any update|any news|any word)\??\.?\s*$/i,
];

function hasEscalationSignals(text: string): boolean {
  return ESCALATION_SIGNALS.some(p => p.test(text));
}

function matchesAckPattern(text: string): boolean {
  const stripped = text.replace(/^(hi|hello|hey|dear)\s+\w+[,.]?\s*/i, "").trim();
  return ACK_PATTERNS.some(p => p.test(stripped)) || ACK_PATTERNS.some(p => p.test(text));
}

function matchesCoordinationPattern(text: string): boolean {
  return INTERNAL_COORDINATION_PATTERNS.some(p => p.test(text));
}

// ─── Closure detection ───────────────────────────────────────────────────────
// Phrases that indicate the original reporter is confirming the issue is fixed.

const CLOSURE_PHRASES: RegExp[] = [
  /working now/i,
  /it'?s (now )?working/i,
  /it is (now )?working/i,
  /fixed( now)?/i,
  /it'?s fixed/i,
  /it is fixed/i,
  /issue (is |has been )?resolved/i,
  /\bresolved\b/i,
  /all good( now)?/i,
  /we'?re (all )?good/i,
  /we are (all )?good/i,
  /this is fixed/i,
  /confirmed working/i,
  /no longer (an )?issue/i,
  /(you can |please )?close (this|the ticket|the issue)/i,
  /we'?re all set/i,
  /we are all set/i,
  /problem (is |has been )?solved/i,
  /seems (to be )?working/i,
  /appears (to be )?working/i,
  /back (to )?working/i,
  /thanks.*working/i,
  /thank you.*working/i,
];

// Returns true if the stripped reply body contains a closure/resolution phrase.
// Run this on extractNewReplyBody output, not the raw body.
export function checkIsClosureReply(strippedBody: string): boolean {
  if (!strippedBody.trim()) return false;
  return CLOSURE_PHRASES.some(p => p.test(strippedBody));
}

// ─── External customer reply classification ───────────────────────────────────
// These run on external (non-Grata) senders who reply to a tracked open thread.
// The patterns are intentionally broad — we want to err on the side of treating
// a reply as meaningful rather than silently discarding it.

const CUSTOMER_ESCALATION_SIGNALS: RegExp[] = [
  /\beta\b/i,                                              // "any ETA", "what's the ETA"
  /when (will|can|is|are) (this|it|the|they|you)/i,
  /how (long|soon)/i,
  /still (not |)(working|fixed|resolved|down|broken|open|waiting|happening|an issue)/i,
  /still (no (update|response|fix|resolution|answer))/i,
  /hasn'?t (been fixed|been resolved|worked|changed)/i,
  /have(n'?t| not) (heard|received|gotten|got) (back|a response|an update|anything)/i,
  /bypass(ed|ing)?/i,
  /workaround/i,
  /override[ds]?/i,
  /security (concern|risk|issue|problem)/i,
  /access (concern|risk|issue|problem)/i,
  /open (to all|for everyone|unrestricted)/i,
  /all (residents?|tenants?|floors?|units?|people|occupants?)/i,
  /everyone (can'?t|cannot|is|has|affected)/i,
  /escalat(e|ed|ing)/i,
  /urgent(ly)?/i,
  /\basap\b/i,
  /immediately/i,
  /right (now|away)/i,
  /getting worse/i,
  /more (people|residents?|tenants?) (are |)affected/i,
  /no (one|one has) (responded?|replied?|followed? up|looked? into)/i,
  /need (an |a )?(update|response|answer|fix|resolution|help)/i,
  /any (update|news|word|progress|response|fix)\??/i,
  /can you (please )?(update|provide|let us know|give us|advise)/i,
];

// Short, clearly-meaningless replies from external senders that don't warrant a
// Slack notification or any update to the existing triage item.
const EXTERNAL_NOISE_PATTERNS: RegExp[] = [
  /^thank(s| you)[!.,]?\s*$/i,
  /^(thanks|thank you) (so much|very much|a lot)[!.]?\s*$/i,
  /^(ok|okay|got it|noted|sounds good|perfect|great|wonderful)[!.]?\s*$/i,
  /^(acknowledged|confirmed|understood|received)[!.]?\s*$/i,
  /^(received,? )?thank(s| you)[!.,]?\s*$/i,
  /^appreciate (it|that|your (help|response|quick response|time))[!.]?\s*$/i,
  /^(have a (great|good|nice) (day|weekend|evening)|take care)[!.]?\s*$/i,
];

// Returns true if the new reply body signals escalation — ETA demands, workarounds,
// broader impact, security risk, etc. Run this on extractNewReplyBody output.
export function checkIsCustomerEscalation(strippedBody: string): boolean {
  if (!strippedBody.trim()) return false;
  return CUSTOMER_ESCALATION_SIGNALS.some(p => p.test(strippedBody));
}

// Returns true for very short, clearly meaningless external replies that should be
// silently discarded without any Slack notification. Only matches unambiguous noise
// (capped at 150 chars to avoid false-positives on longer messages).
export function checkIsNoisyExternalReply(strippedBody: string): boolean {
  const trimmed = strippedBody.trim();
  if (!trimmed) return true;
  if (trimmed.length > 150) return false;
  return EXTERNAL_NOISE_PATTERNS.some(p => p.test(trimmed));
}

// ─── Customer acknowledgement detection ─────────────────────────────────────
// Patterns for replies that are purely polite acknowledgements with no
// actionable content — "Okay, thank you!", "Sounds good, thanks!", etc.
// Applied AFTER signature and quote stripping.

const MAX_CUSTOMER_ACK_CHARS = 300;

const CUSTOMER_ACK_PATTERNS: RegExp[] = [
  // Pure thanks
  /^thank(s| you)[!.,]?\s*$/i,
  /^(thanks|thank you) (so much|very much|a lot)[!.,]?\s*$/i,
  /^(thanks|thank you) for (your (help|time|response|quick response|assistance|support|patience|update)|getting back|reaching out|the update|the heads[-\s]?up|looking into (this|it)|the quick turnaround)[!.,]?\s*$/i,

  // "Okay / Ok" + thanks
  /^(ok(ay)?)[,!.]?\s+thank(s| you)[!.,]?\s*$/i,

  // Great / Perfect / Wonderful + optional thanks
  /^(great|perfect|wonderful|excellent|fantastic|brilliant)[,!.]?\s*(thank(s| you)[!.,]?)?\s*$/i,

  // Sounds good / Looks good / That works + optional thanks
  /^(sounds good|looks good|that works|that'?s fine|that'?s great)[,!.]?\s*(thank(s| you)[!.,]?)?\s*$/i,

  // Got it / Understood / Noted + optional thanks
  /^(got it|understood|noted|confirmed|acknowledged|received)[,!.]?\s*(thank(s| you)[!.,]?)?\s*$/i,

  // Will do / Sure / Of course + optional thanks
  /^(will do|sure|of course|absolutely|no problem|sure thing|my pleasure)[,!.]?\s*(thank(s| you)[!.,]?)?\s*$/i,

  // Appreciate it
  /^(i |we )?appreciate (it|that|this|your (help|response|time|patience|assistance|quick response|support|update))[!.,]?\s*$/i,

  // Have a good/great day + optional thanks
  /^(thanks?[!.,]\s+)?have a (great|good|nice|wonderful) (day|week|weekend|evening|rest of [a-z\s]+)[!.,]?\s*$/i,
  /^have a (great|good|nice|wonderful) (day|week|weekend|evening)[,!.]?\s*(thank(s| you)[!.,]?)?\s*$/i,

  // "Thank you, have a great day" combos
  /^thank(s| you)[,!.]\s+(and )?have a (great|good|nice|wonderful) (day|week|weekend|evening)[!.,]?\s*$/i,

  // "Great, thank you" / "Perfect, thank you"
  /^(great|perfect|sounds good|got it|wonderful)[,!]\s+thank(s| you)[!.,]?\s*$/i,
];

// Returns true if the stripped reply body is purely a customer acknowledgement
// (thanks, confirmation of receipt, polite closing) with no actionable content.
// Run this on extractNewReplyBody() output — signatures and quotes already removed.
export function checkIsCustomerAcknowledgement(strippedBody: string): boolean {
  const trimmed = strippedBody.trim();
  // Empty body after stripping → nothing actionable
  if (!trimmed) return true;
  // Long messages are unlikely to be purely acknowledgements
  if (trimmed.length > MAX_CUSTOMER_ACK_CHARS) return false;
  // Strip leading greeting ("Hi John," / "Hello,") before pattern matching
  const withoutGreeting = trimmed
    .replace(/^(hi|hello|hey|dear)\s+[\w]+[,.]?\s*/i, "")
    .trim();
  return (
    CUSTOMER_ACK_PATTERNS.some(p => p.test(withoutGreeting)) ||
    CUSTOMER_ACK_PATTERNS.some(p => p.test(trimmed))
  );
}

// ─── Message kind ─────────────────────────────────────────────────────────────

export type MessageKind =
  | "original_issue_report"
  | "customer_acknowledgement"
  | "internal_acknowledgement"
  | "internal_coordination"
  | "internal_escalation"
  | "external_customer_update"
  | "external_escalation"
  | "customer_update"
  | "customer_escalation"
  | "reporter_confirmed_resolved"
  | "duplicate_thread_reply"
  | "unknown_reply";

// ─── Thread context detection ─────────────────────────────────────────────────

export interface ThreadContext {
  isThreadReply: boolean;
  priorMessageCount: number;
  existingTriageItem: TriageItem | null;
}

export async function detectThreadContext(email: InboundEmail): Promise<ThreadContext> {
  const threadId = email.gmail_thread_id;
  if (!threadId) {
    return { isThreadReply: false, priorMessageCount: 0, existingTriageItem: null };
  }

  const priorCount = await inboundEmailsRepo.countThreadSiblings(threadId, email.id);
  const hasSubjectPrefix = REPLY_SUBJECT_RE.test(email.subject ?? "");
  const isThreadReply = priorCount > 0 || hasSubjectPrefix;

  if (!isThreadReply) {
    return { isThreadReply: false, priorMessageCount: priorCount, existingTriageItem: null };
  }

  const existingTriageItem = await triageItemsRepo.findOpenByThreadId(threadId, email.id);
  return { isThreadReply: true, priorMessageCount: priorCount, existingTriageItem };
}

// ─── Suppression check ────────────────────────────────────────────────────────

export interface SuppressCheckResult {
  shouldSuppress: boolean;
  messageKind: MessageKind;
  reason: string;
  newReplyBody: string;        // quote-stripped body used for the check
  newReplyBodyLength: number;
}

// Determines whether a thread reply from an internal sender should be suppressed
// before any AI call. External senders are never suppressed here — they go through
// full AI classification with thread context.
//
// Suppresses when the new reply body (after stripping quoted content) is:
//  - Empty / only quoted text
//  - Matches a classic acknowledgement pattern ("thanks, noted, received...")
//  - Matches an internal coordination pattern ("copying X", "must be an IP change", ...)
//
// Never suppresses when escalation signals are detected ("still broken", "urgent", ...).
export function checkShouldSuppressReply(email: InboundEmail): SuppressCheckResult {
  const rawBody = (email.body_text ?? email.snippet ?? "").trim();
  const newReplyBody = extractNewReplyBody(rawBody);
  const newReplyBodyLength = newReplyBody.length;

  if (!isInternalSenderEmail(email.sender_email ?? "")) {
    return {
      shouldSuppress: false,
      messageKind: "external_customer_update",
      reason: "external_sender",
      newReplyBody,
      newReplyBodyLength,
    };
  }

  if (!newReplyBody) {
    return {
      shouldSuppress: true,
      messageKind: "internal_acknowledgement",
      reason: "empty_new_reply_body",
      newReplyBody,
      newReplyBodyLength,
    };
  }

  if (hasEscalationSignals(newReplyBody)) {
    return {
      shouldSuppress: false,
      messageKind: "internal_escalation",
      reason: "escalation_signals_detected",
      newReplyBody,
      newReplyBodyLength,
    };
  }

  if (newReplyBody.length > MAX_SUPPRESS_CHARS) {
    return {
      shouldSuppress: false,
      messageKind: "unknown_reply",
      reason: "body_too_long_for_heuristic",
      newReplyBody,
      newReplyBodyLength,
    };
  }

  if (matchesAckPattern(newReplyBody)) {
    return {
      shouldSuppress: true,
      messageKind: "internal_acknowledgement",
      reason: "matches_acknowledgement_pattern",
      newReplyBody,
      newReplyBodyLength,
    };
  }

  if (matchesCoordinationPattern(newReplyBody)) {
    return {
      shouldSuppress: true,
      messageKind: "internal_coordination",
      reason: "matches_coordination_pattern",
      newReplyBody,
      newReplyBodyLength,
    };
  }

  return {
    shouldSuppress: false,
    messageKind: "unknown_reply",
    reason: "no_suppression_pattern_matched",
    newReplyBody,
    newReplyBodyLength,
  };
}

// Backward-compatible alias used by existing callers.
export function checkIsObviousAcknowledgement(
  email: InboundEmail
): { isAcknowledgement: boolean; reason: string } {
  const r = checkShouldSuppressReply(email);
  return { isAcknowledgement: r.shouldSuppress, reason: r.reason };
}
