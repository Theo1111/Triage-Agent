// V1 routing allowlist.
//
// Person destinations route via conversations.open (requires a U… member ID).
// Channel destinations route via chat.postMessage directly (requires the bot
// to be invited to the channel first: /invite @<bot-name>).
//
// Routing is determined by the destination value, not the type dropdown — so
// selecting "Send to person" and picking "Theo" always DMs Theo, regardless of
// which type option the sender had active.

export type DestinationType = "person" | "channel";

export interface PersonDestination {
  key: string;
  label: string;
  type: "person";
  // Slack member ID (U…). Resolved from SLACK_THEO_USER_ID at runtime.
  envKey: "SLACK_THEO_USER_ID";
}

export interface ChannelDestination {
  key: string;
  label: string;
  type: "channel";
  // Slack channel ID (C…). Resolved from env at runtime.
  envKey: "SLACK_ROUTE_TEST_CHANNEL_ID";
}

export type ApprovedDestination = PersonDestination | ChannelDestination;

export const APPROVED_DESTINATIONS: ApprovedDestination[] = [
  {
    key: "theo",
    label: "Theo",
    type: "person",
    envKey: "SLACK_THEO_USER_ID",
  },
  {
    key: "ops_test",
    label: "operations-triage-agent-test-secondary",
    type: "channel",
    envKey: "SLACK_ROUTE_TEST_CHANNEL_ID",
  },
];

export function findApprovedDestination(key: string): ApprovedDestination | undefined {
  return APPROVED_DESTINATIONS.find((d) => d.key === key);
}

// Encode a destination for use as a Slack modal option value.
// Format: "<type>:<key>" — routing logic uses this, not the type dropdown.
export function encodeDestValue(dest: ApprovedDestination): string {
  return `${dest.type}:${dest.key}`;
}

// Decode a modal option value back to { type, key }.
export function decodeDestValue(
  value: string
): { type: DestinationType; key: string } | null {
  const colon = value.indexOf(":");
  if (colon === -1) return null;
  const type = value.slice(0, colon) as DestinationType;
  const key = value.slice(colon + 1);
  if ((type !== "person" && type !== "channel") || !key) return null;
  return { type, key };
}
