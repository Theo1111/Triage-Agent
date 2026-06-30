// Builds the Route / Notify modal for Slack button interactions.
//
// The Destination dropdown shows all approved destinations. Its value encodes
// type+key (e.g. "person:theo") so routing logic never depends on the separate
// Destination type dropdown — that dropdown is purely UX context for the sender.

import {
  APPROVED_DESTINATIONS,
  encodeDestValue,
} from "@/src/config/slackRouteDestinations";

export interface RouteModalPrivateMeta {
  triageItemId: string;
  responseUrl: string;
}

export function buildRouteModal(triageItemId: string, responseUrl: string): unknown {
  const privateMeta: RouteModalPrivateMeta = { triageItemId, responseUrl };

  const destinationOptions = APPROVED_DESTINATIONS.map((d) => ({
    text: { type: "plain_text" as const, text: d.label },
    value: encodeDestValue(d),
  }));

  return {
    type: "modal",
    callback_id: "triage_route_modal",
    title: { type: "plain_text", text: "Route / Notify", emoji: false },
    submit: { type: "plain_text", text: "Send", emoji: false },
    close: { type: "plain_text", text: "Cancel", emoji: false },
    private_metadata: JSON.stringify(privateMeta),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Select where to route this triage item. Only approved destinations are shown.",
        },
      },
      {
        type: "input",
        block_id: "route_type_block",
        label: { type: "plain_text", text: "Destination type", emoji: false },
        element: {
          type: "static_select",
          action_id: "route_type",
          placeholder: { type: "plain_text", text: "Select type…", emoji: false },
          options: [
            { text: { type: "plain_text", text: "Send to person" }, value: "person" },
            { text: { type: "plain_text", text: "Send to channel" }, value: "channel" },
          ],
        },
      },
      {
        type: "input",
        block_id: "route_destination_block",
        label: { type: "plain_text", text: "Destination", emoji: false },
        element: {
          type: "static_select",
          action_id: "route_destination",
          placeholder: { type: "plain_text", text: "Select destination…", emoji: false },
          options: destinationOptions,
        },
      },
      {
        type: "input",
        block_id: "route_note_block",
        optional: true,
        label: { type: "plain_text", text: "Note (optional)", emoji: false },
        element: {
          type: "plain_text_input",
          action_id: "route_note",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Add context for the recipient…",
            emoji: false,
          },
        },
      },
    ],
  };
}
