import * as inboxesRepo from "@/src/repositories/monitoredInboxesRepository";
import type { MonitoredInbox } from "@/src/types/database";

export async function getOrCreateInbox(input: {
  emailAddress: string;
  displayName?: string;
}): Promise<MonitoredInbox> {
  return inboxesRepo.upsert({
    emailAddress: input.emailAddress,
    displayName: input.displayName ?? input.emailAddress,
    provider: "gmail",
    authType: "oauth",
  });
}

export async function requireActiveInboxByEmail(email: string): Promise<MonitoredInbox> {
  const inbox = await inboxesRepo.findByEmail(email);
  if (!inbox) throw new Error(`No active monitored inbox found for ${email}`);
  return inbox;
}
