import type { InboundEmail, TriageItem } from "@/src/types/database";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import * as triageItemsRepo from "@/src/repositories/triageItemsRepository";
import { getInternalDomains } from "@/src/config/env";

// ─── Constants ────────────────────────────────────────────────────────────────

// Grata's own domain is always treated as internal regardless of INTERNAL_EMAIL_DOMAINS.
const GRATA_DOMAIN = "grata.life";

// If the unquoted body exceeds this, don't auto-suppress (let the model decide).
const ACK_MAX_CHARS = 400;

// Common reply subject prefixes across email clients.
const REPLY_SUBJECT_RE = /^(re|fwd|fw|aw|antw|sv|rv|tr)\s*:\s*/i;

// Signals that a reply is actually escalating the issue — block auto-suppression even
// if the sender is internal and the body is short.
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
  /urgent(ly)?/i,
  /all (residents?|tenants?|occupants?)/i,
  /everyone (is|can'?t|cannot)/i,
  /blocking (launch|deploy|release)/i,
  /production (is )?down/i,
];

// Patterns for simple acknowledgements. Matched against the body with quoted lines stripped.
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function senderDomain(email: InboundEmail): string {
  return (email.sender_email ?? "").split("@")[1]?.toLowerCase() ?? "";
}

function isInternalSender(email: InboundEmail): boolean {
  const domain = senderDomain(email);
  if (!domain) return false;
  if (domain === GRATA_DOMAIN) return true;
  const configured = getInternalDomains();
  return configured.includes(domain);
}

// Strip quoted reply lines ("> text", "On ... wrote:") before evaluating body length/patterns.
function stripQuotedText(body: string): string {
  return body
    .split("\n")
    .filter(line => {
      const t = line.trimStart();
      return !t.startsWith(">") && !t.startsWith("On ") && !t.match(/^-{3,}Original/i);
    })
    .join("\n")
    .trim();
}

function hasEscalationSignals(text: string): boolean {
  return ESCALATION_SIGNALS.some(p => p.test(text));
}

function matchesAckPattern(text: string): boolean {
  // Strip leading salutation ("Hi Tracey," / "Dear John,") before matching
  const withoutSalutation = text.replace(/^(hi|hello|hey|dear)\s+\w+[,.]?\s*/i, "").trim();
  return (
    ACK_PATTERNS.some(p => p.test(withoutSalutation)) ||
    ACK_PATTERNS.some(p => p.test(text))
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ThreadContext {
  isThreadReply: boolean;
  priorMessageCount: number;   // other emails already stored for this thread
  existingTriageItem: TriageItem | null;
}

// Looks up thread siblings and existing triage item in the DB.
// Returns quickly for non-reply emails (no gmail_thread_id → not a reply).
export async function detectThreadContext(email: InboundEmail): Promise<ThreadContext> {
  const threadId = email.gmail_thread_id;

  // No thread ID: definitely not a reply.
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

export interface AckCheckResult {
  isAcknowledgement: boolean;
  reason: string;
}

// Heuristic check: is this an obvious internal acknowledgement that should not produce a new Slack alert?
//
// Only auto-suppresses when:
//   1. Sender is internal (@grata.life or INTERNAL_EMAIL_DOMAINS)
//   2. No escalation signals in the body
//   3. Body (without quoted text) is short and matches an ack pattern, OR is empty
//
// External senders always go through full AI classification, even for short replies.
export function checkIsObviousAcknowledgement(email: InboundEmail): AckCheckResult {
  if (!isInternalSender(email)) {
    return { isAcknowledgement: false, reason: "external_sender" };
  }

  const rawBody = (email.body_text ?? email.snippet ?? "").trim();

  // Empty body from internal sender in a thread → suppress
  if (!rawBody) {
    return { isAcknowledgement: true, reason: "empty_body_internal_reply" };
  }

  const body = stripQuotedText(rawBody);

  // If the stripped body is still empty (e.g. sender only quoted), suppress
  if (!body) {
    return { isAcknowledgement: true, reason: "quoted_only_internal_reply" };
  }

  // Any escalation signal → never suppress
  if (hasEscalationSignals(body)) {
    return { isAcknowledgement: false, reason: "escalation_signals_detected" };
  }

  // Body too long → send to AI
  if (body.length > ACK_MAX_CHARS) {
    return { isAcknowledgement: false, reason: "body_too_long" };
  }

  // Short body + matches ack pattern → suppress
  if (matchesAckPattern(body)) {
    return { isAcknowledgement: true, reason: "matches_acknowledgement_pattern" };
  }

  return { isAcknowledgement: false, reason: "no_ack_pattern_matched" };
}
