import { getInternalDomains, getAutomatedAlertDenylist } from "@/src/config/env";
import { GMAIL_LABEL_INBOX } from "@/src/config/gmail";
import type { EmailFilterInput, EmailFilterResult } from "@/src/types/ingestion";

// Subject-line keywords that override the automated-alert denylist.
// Even messages from noreply@ / alerts@ addresses are ingested when the
// subject indicates an urgent operational issue.
const OPERATIONAL_OVERRIDE_TERMS = [
  "lockout", "locked out", "unable to enter",
  "access", "access issue", "no access",
  "outage", "service outage",
  "camera down", "camera offline", "camera",
  "intercom down", "intercom",
  "payment", "payment issue",
  "app broken", "app down", "app issue",
  "resident stuck", "resident",
  "hardware failure", "hardware",
  "building access",
  "ict",
  "spear",
  "engineering", "eng issue",
  "door", "elevator", "hvac",
  "leak", "flooding",
  "offline", "down", "broken", "failure", "failed",
];

function hasOperationalSignal(subject: string): boolean {
  const lower = subject.toLowerCase();
  return OPERATIONAL_OVERRIDE_TERMS.some((term) => lower.includes(term));
}

export function isExternalEmail(senderEmail: string, internalDomains: string[]): boolean {
  if (!senderEmail) return false;
  const domain = senderEmail.split("@")[1]?.toLowerCase() ?? "";
  return !internalDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function isAutomatedAlert(senderEmail: string, denylist: string[]): boolean {
  const lower = senderEmail.toLowerCase();
  return denylist.some((prefix) => lower.startsWith(prefix) || lower.includes(`+${prefix}`));
}

export function hasInboxLabel(labelIds: string[]): boolean {
  return labelIds.includes(GMAIL_LABEL_INBOX);
}

export function shouldIngestEmail(input: EmailFilterInput): EmailFilterResult {
  const internalDomains = getInternalDomains();
  const denylist = getAutomatedAlertDenylist();

  // Gate 1: must be in the inbox (not Sent, Drafts, Spam, etc.)
  if (!hasInboxLabel(input.labelIds)) {
    return {
      shouldIngest: false,
      isExternal: false,
      isAutomatedAlert: false,
      hasInboxLabel: false,
      skipReason: "not_inbox",
    };
  }

  // Classify is_external for context/labeling — NOT used as a filter.
  // Emails from internal Grata senders and external senders are both ingested.
  const external = isExternalEmail(input.senderEmail, internalDomains);

  // Gate 2: automated-alert denylist (no-reply, noreply, alerts, notifications, etc.)
  // Override: if the subject contains an urgent operational signal, allow through
  // even from a denylist sender.
  const automated = isAutomatedAlert(input.senderEmail, denylist);
  if (automated) {
    const subject = input.headers["subject"] ?? "";
    if (hasOperationalSignal(subject)) {
      console.log(
        `[filter] automated sender override — operational signal in subject="${subject}" sender=${input.senderEmail}`
      );
      return {
        shouldIngest: true,
        isExternal: external,
        isAutomatedAlert: true,
        hasInboxLabel: true,
      };
    }
    return {
      shouldIngest: false,
      isExternal: external,
      isAutomatedAlert: true,
      hasInboxLabel: true,
      skipReason: "automated_alert",
    };
  }

  return {
    shouldIngest: true,
    isExternal: external,
    isAutomatedAlert: false,
    hasInboxLabel: true,
  };
}
