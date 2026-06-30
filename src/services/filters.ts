import { getInternalDomains, getAutomatedAlertDenylist } from "@/src/config/env";
import { GMAIL_LABEL_INBOX } from "@/src/config/gmail";
import type { EmailFilterInput, EmailFilterResult } from "@/src/types/ingestion";

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

  const inboxLabelPresent = hasInboxLabel(input.labelIds);
  if (!inboxLabelPresent) {
    return {
      shouldIngest: false,
      isExternal: false,
      isAutomatedAlert: false,
      hasInboxLabel: false,
      skipReason: "not_inbox",
    };
  }

  const external = isExternalEmail(input.senderEmail, internalDomains);
  if (!external) {
    return {
      shouldIngest: false,
      isExternal: false,
      isAutomatedAlert: false,
      hasInboxLabel: true,
      skipReason: "internal",
    };
  }

  const automated = isAutomatedAlert(input.senderEmail, denylist);
  if (automated) {
    return {
      shouldIngest: false,
      isExternal: true,
      isAutomatedAlert: true,
      hasInboxLabel: true,
      skipReason: "automated_alert",
    };
  }

  return {
    shouldIngest: true,
    isExternal: true,
    isAutomatedAlert: false,
    hasInboxLabel: true,
  };
}
