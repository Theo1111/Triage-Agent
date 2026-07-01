import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { verifySlackSignature } from "@/src/lib/slack/verifySignature";
import {
  updateSlackMessage,
  postMessage,
  openDmChannel,
  openModal,
} from "@/src/lib/slack/slackWebApi";
import {
  assignTriageItem,
  unassignTriageItem,
  resolveTriageItem,
  reopenTriageItem,
  escalateTriageItem,
} from "@/src/services/triageItems";
import { getCurrentClassification } from "@/src/services/classification";
import { buildSlackUpdateBlocks } from "@/src/services/slackAlerts";
import { logEvent } from "@/src/services/agentAuditLog";
import { buildRouteModal } from "@/src/lib/slack/slackRouteModal";
import {
  findApprovedDestination,
  decodeDestValue,
} from "@/src/config/slackRouteDestinations";
import type { TriageItem } from "@/src/types/database";

export const dynamic = "force-dynamic";

// ─── Slack interaction payload types ─────────────────────────────────────────

interface SlackUser {
  id: string;
  name: string;
  username?: string;
}

interface SlackBlockAction {
  action_id: string;
  value: string;
  type: string;
}

interface SlackMessage {
  ts: string;
  thread_ts?: string;
}

interface SlackChannel {
  id: string;
  name?: string;
}

interface SlackBlockActionsPayload {
  type: "block_actions";
  user: SlackUser;
  actions: SlackBlockAction[];
  channel?: SlackChannel;
  message?: SlackMessage;
  response_url?: string;
  trigger_id?: string;
}

interface SlackViewSubmissionPayload {
  type: "view_submission";
  user: SlackUser;
  view: {
    id: string;
    callback_id: string;
    private_metadata: string;
    state: {
      values: Record<
        string,
        Record<
          string,
          {
            type: string;
            selected_option?: { value: string; text?: { text: string } } | null;
            value?: string | null;
          }
        >
      >;
    };
  };
}

type SlackPayload = SlackBlockActionsPayload | SlackViewSubmissionPayload;

// ─── Slack message update via response_url or chat.update fallback ────────────

async function applySlackUpdate(opts: {
  item: TriageItem;
  statusText: string;
  channelId: string | undefined;
  messageTs: string | undefined;
  responseUrl: string | undefined;
}): Promise<void> {
  const { item, statusText, channelId, messageTs, responseUrl } = opts;

  const classification = await getCurrentClassification(item.inbound_email_id).catch(() => null);
  const updated = buildSlackUpdateBlocks(item, {
    urgencyReason: classification?.urgency_reason ?? null,
    primaryCategory: classification?.primary_category ?? null,
    statusText,
  });

  console.log(
    `[slack/actions] update attempt triage=${item.id} status=${item.status} ` +
    `channel=${channelId ?? "?"} ts=${messageTs ?? "?"} ` +
    `response_url=${responseUrl ? "present" : "absent"}`
  );

  if (responseUrl) {
    try {
      const res = await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace_original: true, text: updated.text, blocks: updated.blocks }),
      });
      const body = await res.text();
      if (res.ok && body === "ok") {
        console.log(`[slack/actions] card updated via response_url triage=${item.id}`);
      } else {
        console.warn(`[slack/actions] response_url status=${res.status} body=${body}`);
      }
    } catch (err) {
      console.error(`[slack/actions] response_url update failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    const botToken = env.SLACK_BOT_TOKEN;
    if (!botToken) {
      console.warn("[slack/actions] Slack message update skipped because SLACK_BOT_TOKEN is missing.");
    } else if (!channelId || !messageTs) {
      console.warn(`[slack/actions] chat.update skipped — missing channel/ts (channel=${channelId ?? "?"} ts=${messageTs ?? "?"})`);
    } else {
      try {
        await updateSlackMessage(botToken, channelId, messageTs, updated.text, updated.blocks);
        console.log(`[slack/actions] card updated via chat.update channel=${channelId} ts=${messageTs} triage=${item.id}`);
      } catch (err) {
        console.error(`[slack/actions] chat.update failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

}

// ─── Route/Notify: post the routed DM message ─────────────────────────────────

function buildRoutedDmBlocks(
  item: TriageItem,
  opts: {
    routedBySlackUserId: string;
    destinationLabel: string;
    note: string | null;
    classification: { urgency_reason?: string | null; primary_category?: string | null } | null;
  }
): { text: string; blocks: unknown[] } {
  const senderDisplay = item.sender_name
    ? `${item.sender_name} <${item.sender_email ?? "unknown"}>`
    : (item.sender_email ?? "Unknown sender");

  const subject = item.subject ?? "(no subject)";
  const summary = item.summary ?? "(no summary)";
  const urgencyReason = opts.classification?.urgency_reason ?? "—";
  const nextStep = item.recommended_next_step ?? "—";
  const currentOwner = item.owner ?? "unassigned";
  const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");

  const text = `🔀 Triage item routed to ${opts.destinationLabel} by <@${opts.routedBySlackUserId}>: ${subject}`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🔀 Triage Item Routed to You", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Routed by <@${opts.routedBySlackUserId}>${opts.note ? `\n*Note:* ${opts.note}` : ""}`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From:*\n${senderDisplay}` },
        { type: "mrkdwn", text: `*Source inbox:*\n${item.source_inbox_email}` },
        { type: "mrkdwn", text: `*Subject:*\n${subject}` },
        { type: "mrkdwn", text: `*Status / Owner:*\n${item.status} / ${currentOwner}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Summary:*\n${summary}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Why urgent:*\n${urgencyReason}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Recommended next step:*\n${nextStep}` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Triage item: \`${item.id}\`` +
            (appBaseUrl ? ` | <${appBaseUrl}/dashboard|Open dashboard>` : ""),
        },
      ],
    },
  ];

  return { text, blocks };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Read raw body — must happen before any parsing for HMAC verification.
  const rawBody = await req.text();

  // 2. Verify Slack signature.
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";
  const signingSecret = env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    console.error("[slack/actions] SLACK_SIGNING_SECRET not configured");
    return NextResponse.json({ error: "Slack not configured" }, { status: 500 });
  }

  if (!verifySlackSignature(signingSecret, rawBody, timestamp, signature)) {
    console.error(
      `[slack/actions] Signature verification failed ts=${timestamp} sig=${signature.slice(0, 16)}…`
    );
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 3. Parse URL-encoded payload.
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return new NextResponse("Missing payload", { status: 400 });
  }

  let payload: SlackPayload;
  try {
    payload = JSON.parse(payloadStr) as SlackPayload;
  } catch {
    return new NextResponse("Invalid payload JSON", { status: 400 });
  }

  // ── view_submission: modal submitted ────────────────────────────────────────
  if (payload.type === "view_submission") {
    return handleRouteModalSubmit(payload);
  }

  // ── block_actions: button clicked ──────────────────────────────────────────
  if (payload.type !== "block_actions") {
    return new NextResponse(null, { status: 200 });
  }

  const action = payload.actions[0];
  if (!action) {
    return new NextResponse(null, { status: 200 });
  }

  const triageItemId = action.value;
  const slackUserId = payload.user.id;
  const slackUsername = payload.user.username ?? payload.user.name ?? slackUserId;
  const channelId = payload.channel?.id;
  const messageTs = payload.message?.ts;
  const responseUrl = payload.response_url;
  const triggerId = payload.trigger_id;

  if (!triageItemId) {
    console.error(`[slack/actions] action_id=${action.action_id} has empty value (no triageItemId)`);
    return NextResponse.json({
      replace_original: false,
      text: "⚠️ This button is missing required triage information. Please contact an admin.",
    });
  }

  console.log(
    `[slack/actions] action=${action.action_id} triage=${triageItemId} ` +
    `user=${slackUserId} channel=${channelId ?? "?"} ts=${messageTs ?? "?"} ` +
    `trigger_id=${triggerId ? "present" : "absent"}`
  );

  // ── Route / Notify: open modal ─────────────────────────────────────────────
  if (action.action_id === "triage_route_open_modal") {
    const botToken = env.SLACK_BOT_TOKEN;
    if (!botToken) {
      console.error("[slack/actions] SLACK_BOT_TOKEN required for views.open");
      return NextResponse.json({
        replace_original: false,
        text: "⚠️ Route / Notify is not configured. SLACK_BOT_TOKEN is missing.",
      });
    }
    if (!triggerId) {
      console.error("[slack/actions] Missing trigger_id — cannot open modal");
      return NextResponse.json({
        replace_original: false,
        text: "⚠️ Could not open routing modal (missing trigger_id). Please try again.",
      });
    }
    if (!responseUrl) {
      console.warn("[slack/actions] No response_url on route modal open — card will not be updated after routing");
    }

    const modal = buildRouteModal(triageItemId, responseUrl ?? "");
    try {
      await openModal(botToken, triggerId, modal);
      console.log(`[slack/actions] route modal opened triage=${triageItemId} user=${slackUserId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[slack/actions] views.open failed: ${msg}`);
      return NextResponse.json({
        replace_original: false,
        text: `⚠️ Could not open routing modal: ${msg}`,
      });
    }
    // Must return empty 200 — Slack ignores body when opening modal.
    return new NextResponse(null, { status: 200 });
  }

  // ── Unassign — ownership-gated, returns ephemeral error for non-owners ───────
  if (action.action_id === "triage_unassign") {
    try {
      const { item, ownershipError } = await unassignTriageItem(triageItemId, slackUsername);

      if (ownershipError) {
        // Send ephemeral error visible only to the clicking user via response_url.
        if (responseUrl) {
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              response_type: "ephemeral",
              replace_original: false,
              text: `⚠️ ${ownershipError}`,
            }),
          }).catch((e) => console.warn("[slack/actions] ephemeral send failed:", e));
        }
        return NextResponse.json({ ok: true });
      }

      const statusText = `🆕 *Status:* New (unassigned by <@${slackUserId}>)`;

      await logEvent({
        inboundEmailId: item.inbound_email_id,
        eventType: "triage_item_unassigned",
        action: `Unassigned by <@${slackUserId}> (${slackUsername}) via Slack button`,
        actorType: "slack",
        actorId: slackUserId,
        afterState: { status: item.status, owner: item.owner },
        metadata: {
          unassigned_by_slack_user_id: slackUserId,
          unassigned_by_slack_user_name: slackUsername,
        },
      });

      await applySlackUpdate({ item, statusText, channelId, messageTs, responseUrl });
      return NextResponse.json({ ok: true });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[slack/actions] triage_unassign failed triage=${triageItemId}: ${message}`);
      return NextResponse.json({ replace_original: false, text: `⚠️ Could not unassign: ${message}` });
    }
  }

  // ── Assign / Resolve / Reopen ─────────────────────────────────────────────
  try {
    let item: TriageItem;
    let statusText: string;
    let eventType: string;
    let auditAction: string;

    switch (action.action_id) {
      case "triage_assign_to_me": {
        item = await assignTriageItem(triageItemId, slackUsername);
        statusText = `✅ *Status:* Assigned to <@${slackUserId}>`;
        eventType = "triage_assigned_from_slack";
        auditAction = `Assigned to <@${slackUserId}> (${slackUsername}) via Slack button`;
        break;
      }

      case "triage_resolve": {
        item = await resolveTriageItem(triageItemId);
        statusText = `✅ *Status:* Resolved by <@${slackUserId}>`;
        eventType = "triage_resolved_from_slack";
        auditAction = `Resolved by <@${slackUserId}> (${slackUsername}) via Slack button`;
        break;
      }

      case "triage_reopen": {
        item = await reopenTriageItem(triageItemId);
        statusText = `🔄 *Status:* Reopened by <@${slackUserId}>`;
        eventType = "triage_reopened_from_slack";
        auditAction = `Reopened by <@${slackUserId}> (${slackUsername}) via Slack button`;
        break;
      }

      default:
        console.warn(`[slack/actions] unknown action_id: ${action.action_id}`);
        return new NextResponse(null, { status: 200 });
    }

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType,
      action: auditAction,
      actorType: "slack",
      actorId: slackUserId,
      afterState: { status: item.status, owner: item.owner },
    });

    await applySlackUpdate({ item, statusText, channelId, messageTs, responseUrl });
    return NextResponse.json({ ok: true });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[slack/actions] Error on ${action.action_id} triage=${triageItemId}: ${message}`);
    return NextResponse.json({
      replace_original: false,
      text: `⚠️ Could not complete action: ${message}`,
    });
  }
}

// ─── Route modal submission handler ──────────────────────────────────────────

async function handleRouteModalSubmit(
  payload: SlackViewSubmissionPayload
): Promise<NextResponse> {
  const slackUserId = payload.user.id;
  const slackUsername = payload.user.username ?? payload.user.name ?? slackUserId;

  // Parse private_metadata to recover triageItemId and responseUrl.
  let triageItemId: string;
  let responseUrl: string;
  try {
    const meta = JSON.parse(payload.view.private_metadata) as {
      triageItemId: string;
      responseUrl: string;
    };
    triageItemId = meta.triageItemId;
    responseUrl = meta.responseUrl;
  } catch {
    console.error("[slack/actions] Failed to parse modal private_metadata");
    return NextResponse.json({
      response_action: "errors",
      errors: { route_destination_block: "Internal error — could not read triage item. Please close and try again." },
    });
  }

  // Extract form values.
  const values = payload.view.state.values;
  const selectedDestValue = values["route_destination_block"]?.["route_destination"]?.selected_option?.value;
  const note = values["route_note_block"]?.["route_note"]?.value ?? null;

  console.log(
    `[slack/actions] route modal submit triage=${triageItemId} ` +
    `user=${slackUserId} dest_value=${selectedDestValue ?? "?"}`
  );

  if (!selectedDestValue) {
    return NextResponse.json({
      response_action: "errors",
      errors: { route_destination_block: "Please select a destination." },
    });
  }

  // Decode "type:key" from the destination option value, then look up the allowlist.
  // Routing is driven by this value alone — the Destination type dropdown is UX-only.
  const decoded = decodeDestValue(selectedDestValue);
  const approved = decoded ? findApprovedDestination(decoded.key) : null;
  if (!decoded || !approved || approved.type !== decoded.type) {
    console.error(`[slack/actions] Non-approved or unrecognised destination: ${selectedDestValue}`);
    return NextResponse.json({
      response_action: "errors",
      errors: { route_destination_block: "This destination is not approved for routing." },
    });
  }

  const botToken = env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.error("[slack/actions] SLACK_BOT_TOKEN required for routing");
    return NextResponse.json({
      response_action: "errors",
      errors: { route_destination_block: "Routing is not configured (missing bot token). Contact an admin." },
    });
  }

  // ── Resolve target channel based on destination type ──────────────────────
  let targetChannelId: string;

  if (approved.type === "person") {
    // Person destination: use SLACK_THEO_USER_ID (must be U…) with conversations.open.
    const memberId = env.SLACK_THEO_USER_ID;
    if (!memberId) {
      console.error("[slack/actions] SLACK_THEO_USER_ID not set");
      return NextResponse.json({
        response_action: "errors",
        errors: { route_destination_block: "Person routing is not configured (SLACK_THEO_USER_ID missing). Contact an admin." },
      });
    }
    if (!memberId.startsWith("U")) {
      console.error(`[slack/actions] SLACK_THEO_USER_ID="${memberId}" is not a member ID (must start with U)`);
      return NextResponse.json({
        response_action: "errors",
        errors: { route_destination_block: "SLACK_THEO_USER_ID must be a Slack member ID (starts with U). Contact an admin." },
      });
    }
    targetChannelId = await openDmChannel(botToken, memberId);
    console.log(`[slack/actions] opened DM channel=${targetChannelId} for member=${memberId}`);
  } else {
    // Channel destination: post directly to SLACK_ROUTE_TEST_CHANNEL_ID (must be C…).
    // Bot must be invited to the channel: /invite @<bot-name>
    const channelId = env.SLACK_ROUTE_TEST_CHANNEL_ID;
    if (!channelId) {
      console.error("[slack/actions] SLACK_ROUTE_TEST_CHANNEL_ID not set");
      return NextResponse.json({
        response_action: "errors",
        errors: { route_destination_block: "Channel routing is not configured (SLACK_ROUTE_TEST_CHANNEL_ID missing). Contact an admin." },
      });
    }
    targetChannelId = channelId;
  }

  // Execute: escalate triage item, send message, update card, write audit log.
  try {
    const item = await escalateTriageItem(triageItemId);
    const classification = await getCurrentClassification(item.inbound_email_id).catch(() => null);

    const { text, blocks } = buildRoutedDmBlocks(item, {
      routedBySlackUserId: slackUserId,
      destinationLabel: approved.label,
      note: note?.trim() || null,
      classification,
    });
    await postMessage(botToken, targetChannelId, text, blocks);

    console.log(
      `[slack/actions] routed triage=${triageItemId} type=${approved.type} ` +
      `dest="${approved.label}" channel=${targetChannelId} user=${slackUserId}`
    );

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "triage_item_routed",
      action: `Routed to ${approved.label} (${approved.type}) by <@${slackUserId}> (${slackUsername}) via Slack modal`,
      actorType: "slack",
      actorId: slackUserId,
      afterState: { status: item.status, owner: item.owner },
      metadata: {
        routed_by_slack_user_id: slackUserId,
        routed_by_slack_user_name: slackUsername,
        routed_to_type: approved.type,
        routed_to_id: targetChannelId,
        routed_to_label: approved.label,
        note: note?.trim() || null,
      },
    });

    const statusText = `📤 *Status:* Routed to ${approved.label} by <@${slackUserId}>`;
    if (responseUrl) {
      await applySlackUpdate({
        item,
        statusText,
        channelId: undefined,
        messageTs: undefined,
        responseUrl,
      });
    }

    return NextResponse.json({ response_action: "clear" });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[slack/actions] Route modal submission failed triage=${triageItemId}: ${message}`);
    return NextResponse.json({
      response_action: "errors",
      errors: { route_destination_block: `Could not complete routing: ${message}` },
    });
  }
}
