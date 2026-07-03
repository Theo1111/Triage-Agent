import { env } from "@/src/config/env";
import { formatCategoryLabel } from "@/src/lib/formatCategory";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import { getCurrentClassification } from "@/src/services/classification";
import { getCurrentSensitivityReview } from "@/src/services/sensitivityReview";
import { getCurrentRoutingRecommendation } from "@/src/services/routingRecommendations";
import { logEvent } from "@/src/services/agentAuditLog";
import { createTriageItemFromContext } from "@/src/services/triageItems";
import type {
  InboundEmail,
  EmailClassification,
  SensitivityReview,
  RoutingRecommendation,
  TriageItem,
} from "@/src/types/database";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SlackRouteContext {
  email: InboundEmail;
  classification: EmailClassification;
  sensitivityReview: SensitivityReview;
  routingRecommendation: RoutingRecommendation;
}

export interface SlackEligibilityResult {
  eligible: boolean;
  reason: string;
}

export interface SlackRouteResult {
  eligible: boolean;
  action: "posted" | "blocked" | "ignored";
  reason: string;
  urgency_level: string;
  sensitivity_level: string;
  route_type: string;
  channel_name?: string;
  webhookStatus?: number;
  slackResponse?: string;
  triageItemId?: string | null;
}

interface SlackPayload {
  text: string;
  blocks: unknown[];
}

// ─── Eligibility gate ────────────────────────────────────────────────────────
// All conditions must pass. Checked in order from hardest block to positive confirm.

export function isSharedSlackEligible(ctx: SlackRouteContext): SlackEligibilityResult {
  const { classification: c, sensitivityReview: sr, routingRecommendation: rr } = ctx;

  if (c.sensitivity_level === "sensitive") {
    return { eligible: false, reason: "sensitivity_level=sensitive blocks shared Slack" };
  }
  if (c.sensitivity_level === "private") {
    return { eligible: false, reason: "sensitivity_level=private blocks shared Slack" };
  }
  if (!sr.shared_slack_allowed) {
    return { eligible: false, reason: "shared_slack_allowed=false" };
  }
  if (sr.private_route_required) {
    return { eligible: false, reason: "private_route_required=true" };
  }
  if (rr.route_type === "ignore") {
    return { eligible: false, reason: "route_type=ignore" };
  }
  if (rr.route_type === "private_owner") {
    return { eligible: false, reason: "route_type=private_owner — must not go to shared Slack" };
  }
  if (rr.route_type === "manual_review") {
    return { eligible: false, reason: "route_type=manual_review — human decision required before posting" };
  }
  if (rr.route_type === "dashboard_only") {
    return { eligible: false, reason: "route_type=dashboard_only — not eligible for Slack posting" };
  }
  if (c.urgency_level === "not_relevant") {
    return { eligible: false, reason: "urgency_level=not_relevant" };
  }
  if (c.urgency_level === "normal") {
    return { eligible: false, reason: "urgency_level=normal — only urgent emails post to shared Slack" };
  }
  if (c.urgency_level !== "urgent") {
    return { eligible: false, reason: `urgency_level=${c.urgency_level} — only urgent qualifies` };
  }
  if (c.sensitivity_level !== "public_internal") {
    return { eligible: false, reason: `sensitivity_level=${c.sensitivity_level} — only public_internal qualifies` };
  }
  if (rr.route_type !== "slack_channel") {
    return { eligible: false, reason: `route_type=${rr.route_type} — only slack_channel qualifies` };
  }

  return {
    eligible: true,
    reason: "urgent + public_internal + shared_slack_allowed=true + route_type=slack_channel",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export { formatCategoryLabel } from "@/src/lib/formatCategory";
// formatCategoryLabel is imported at the top for use within this module.

// ─── Message builder ─────────────────────────────────────────────────────────
// Only uses classification output fields and safe email metadata.
// Never includes body_text, body_html, raw_mime, or payload_json.

export function buildSlackEscalationMessage(
  ctx: SlackRouteContext,
  triageItemId: string | null
): SlackPayload {
  const { email: e, classification: c } = ctx;

  const senderDisplay = e.sender_name
    ? `${e.sender_name} <${e.sender_email ?? "unknown"}>`
    : (e.sender_email ?? "Unknown sender");

  const subject = e.subject ?? "(no subject)";
  const summary = c.summary ?? "(no summary provided)";
  const category = formatCategoryLabel(c.primary_category);

  const fallbackText = `🚨 Urgent: ${subject} — from ${senderDisplay}. ${summary}`;

  const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
  const viewEmailUrl = appBaseUrl ? `${appBaseUrl}/emails/${e.id}` : null;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🚨 Urgent Email Alert", emoji: true },
    },
    // Two-column metadata
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From:*\n${senderDisplay}` },
        { type: "mrkdwn", text: `*To:*\n${e.source_inbox_email}` },
        { type: "mrkdwn", text: `*Subject:*\n${subject}` },
        { type: "mrkdwn", text: `*Category:*\n${category}` },
        { type: "mrkdwn", text: `*Owner:*\nUnassigned` },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Summary:*\n${summary}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `🆕 *Status:* New` },
    },
  ];

  if (triageItemId) {
    const elements: unknown[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Assign to me", emoji: true },
        action_id: "triage_assign_to_me",
        value: triageItemId,
        style: "primary",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "📤 Route / Notify", emoji: true },
        action_id: "triage_route_open_modal",
        value: triageItemId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🟢 Mark Resolved", emoji: true },
        action_id: "triage_resolve",
        value: triageItemId,
      },
    ];
    if (viewEmailUrl) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "📬 View Email", emoji: true },
        url: viewEmailUrl,
      });
    }
    blocks.push({ type: "actions", elements });
  }

  return { text: fallbackText, blocks };
}

// ─── Update message builder ───────────────────────────────────────────────────
// Rebuilds the full alert card from a stored TriageItem after a button action.
// Adds a visible status line and filters buttons based on current triage status.
// urgencyReason and primaryCategory come from an EmailClassification lookup by the caller.

export function buildSlackUpdateBlocks(
  item: TriageItem,
  opts: {
    urgencyReason?: string | null;
    primaryCategory?: string | null;
    statusText: string;
  }
): SlackPayload {
  const senderDisplay = item.sender_name
    ? `${item.sender_name} <${item.sender_email ?? "unknown"}>`
    : (item.sender_email ?? "Unknown sender");

  const subject = item.subject ?? "(no subject)";
  const summary = item.summary ?? "(no summary)";
  const category = formatCategoryLabel(opts.primaryCategory);
  const owner = item.owner ?? "Unassigned";

  const fallbackText = `${opts.statusText.replace(/\*/g, "")} — ${subject} from ${senderDisplay}`;

  const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
  const viewEmailUrl = appBaseUrl ? `${appBaseUrl}/emails/${item.inbound_email_id}` : null;

  const viewEmailButton = viewEmailUrl
    ? {
        type: "button",
        text: { type: "plain_text", text: "📬 View Email", emoji: true },
        url: viewEmailUrl,
      }
    : null;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🚨 Urgent Email Alert", emoji: true },
    },
    // Two-column metadata
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From:*\n${senderDisplay}` },
        { type: "mrkdwn", text: `*To:*\n${item.source_inbox_email}` },
        { type: "mrkdwn", text: `*Subject:*\n${subject}` },
        { type: "mrkdwn", text: `*Category:*\n${category}` },
        { type: "mrkdwn", text: `*Owner:*\n${owner}` },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Summary:*\n${summary}` },
    },
    // Status line — compact, single line with emoji
    {
      type: "section",
      text: { type: "mrkdwn", text: opts.statusText },
    },
  ];

  // Action buttons — status-gated, always includes View Email
  if (item.status === "resolved") {
    const elements: unknown[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "🔄 Reopen / Undo Resolved", emoji: true },
        action_id: "triage_reopen",
        value: item.id,
      },
    ];
    if (viewEmailButton) elements.push(viewEmailButton);
    blocks.push({ type: "actions", elements });
  } else if (item.status === "assigned") {
    // Unassign is visible to all; server-side ownership check rejects non-owners with ephemeral error.
    const elements: unknown[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "↩️ Unassign", emoji: true },
        action_id: "triage_unassign",
        value: item.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "📤 Route / Notify", emoji: true },
        action_id: "triage_route_open_modal",
        value: item.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🟢 Mark Resolved", emoji: true },
        action_id: "triage_resolve",
        value: item.id,
      },
    ];
    if (viewEmailButton) elements.push(viewEmailButton);
    blocks.push({ type: "actions", elements });
  } else {
    // New / escalated / manual_review / reopened
    const elements: unknown[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Assign to me", emoji: true },
        action_id: "triage_assign_to_me",
        value: item.id,
        style: "primary",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "📤 Route / Notify", emoji: true },
        action_id: "triage_route_open_modal",
        value: item.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🟢 Mark Resolved", emoji: true },
        action_id: "triage_resolve",
        value: item.id,
      },
    ];
    if (viewEmailButton) elements.push(viewEmailButton);
    blocks.push({ type: "actions", elements });
  }

  return { text: fallbackText, blocks };
}

// ─── Customer update message builder ─────────────────────────────────────────
// Used when an external customer/reporter replies to an existing tracked thread.
// Deliberately compact — does NOT look like a new issue alert.

export function buildSlackCustomerUpdateMessage(opts: {
  existingTriageItem: TriageItem;
  replyEmailId: string;
  senderDisplay: string;
  replyBodyPreview: string;
  isEscalation: boolean;
}): SlackPayload {
  const { existingTriageItem, replyEmailId, senderDisplay, replyBodyPreview, isEscalation } = opts;

  const subject = existingTriageItem.subject ?? "(no subject)";
  const emoji = isEscalation ? "⚠️" : "🔄";
  const label = isEscalation ? "Escalation update on existing issue" : "Update on existing issue";
  const statusLine = isEscalation
    ? "⚠️ *Status:* Still open · Escalated"
    : "🔄 *Status:* Still open";

  const preview = replyBodyPreview.length > 400
    ? replyBodyPreview.slice(0, 400) + "…"
    : replyBodyPreview;

  const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
  const viewEmailUrl = appBaseUrl ? `${appBaseUrl}/emails/${replyEmailId}` : null;

  const fallbackText = `${emoji} ${label}: ${subject} — ${senderDisplay}`;

  const bodySection = [
    `${emoji} *${label}: ${subject}*`,
    `*${senderDisplay}* added:`,
    `>>> ${preview.replace(/\n+/g, "\n")}`,
    statusLine,
  ].join("\n");

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: bodySection } },
  ];

  const actionElements: unknown[] = [];
  if (viewEmailUrl) {
    actionElements.push({
      type: "button",
      text: { type: "plain_text", text: "📬 View Thread", emoji: true },
      url: viewEmailUrl,
    });
  }
  if (existingTriageItem.id) {
    actionElements.push({
      type: "button",
      text: { type: "plain_text", text: "🟢 Mark Resolved", emoji: true },
      action_id: "triage_resolve",
      value: existingTriageItem.id,
    });
  }
  if (actionElements.length > 0) {
    blocks.push({ type: "actions", elements: actionElements });
  }

  return { text: fallbackText, blocks };
}

// ─── Webhook sender ──────────────────────────────────────────────────────────

async function sendToWebhook(payload: SlackPayload): Promise<{ status: number; body: string }> {
  const webhookUrl = env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error(
      "SLACK_WEBHOOK_URL is not configured. " +
      "Add it to .env.local to enable Slack posting."
    );
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  return { status: res.status, body };
}

// Public helper — posts any pre-built payload via the Incoming Webhook.
// Used for customer update notifications that don't go through the full routing pipeline.
export async function sendViaWebhook(payload: SlackPayload): Promise<void> {
  try {
    const result = await sendToWebhook(payload);
    if (result.status !== 200 || result.body !== "ok") {
      console.error(`[slack] webhook update returned status=${result.status} body=${result.body}`);
    }
  } catch (err) {
    console.error("[slack] webhook update failed:", err);
  }
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export async function routeClassifiedEmail(inboundEmailId: string): Promise<SlackRouteResult> {
  const email = await inboundEmailsRepo.findById(inboundEmailId);
  if (!email) throw new Error(`Email not found: ${inboundEmailId}`);

  const classification = await getCurrentClassification(inboundEmailId);
  if (!classification) {
    throw new Error(`No current classification for email: ${inboundEmailId}. Run classify-email first.`);
  }

  const sensitivityReview = await getCurrentSensitivityReview(inboundEmailId);
  if (!sensitivityReview) {
    throw new Error(`No sensitivity review for email: ${inboundEmailId}. Run classify-email first.`);
  }

  const routingRecommendation = await getCurrentRoutingRecommendation(inboundEmailId);
  if (!routingRecommendation) {
    throw new Error(`No routing recommendation for email: ${inboundEmailId}. Run classify-email first.`);
  }

  const ctx: SlackRouteContext = {
    email,
    classification,
    sensitivityReview,
    routingRecommendation,
  };

  const eligibility = isSharedSlackEligible(ctx);
  const channelName = env.SLACK_ESCALATION_CHANNEL_NAME;

  const baseAudit = {
    inboundEmailId,
    classificationId: classification.id,
    afterState: {
      urgency_level: classification.urgency_level,
      sensitivity_level: classification.sensitivity_level,
      route_type: routingRecommendation.route_type,
      shared_slack_allowed: sensitivityReview.shared_slack_allowed,
      private_route_required: sensitivityReview.private_route_required,
    },
  };

  if (!eligibility.eligible) {
    const isIgnored =
      classification.urgency_level === "not_relevant" ||
      routingRecommendation.route_type === "ignore";

    const action = isIgnored ? "ignored" : "blocked";

    await logEvent({
      ...baseAudit,
      eventType: "slack_post_blocked",
      action: `Slack posting ${action}: ${eligibility.reason}`,
      reason: eligibility.reason,
    });

    const triageItem = await createTriageItemFromContext(
      { email, classification, routingRecommendation },
      { slackAction: action, slackChannel: channelName ?? null }
    );

    console.log(
      `[slack] ${action} email=${inboundEmailId} ` +
      `reason="${eligibility.reason}"` +
      (triageItem ? ` triage=${triageItem.id}` : "")
    );

    return {
      eligible: false,
      action,
      reason: eligibility.reason,
      urgency_level: classification.urgency_level,
      sensitivity_level: classification.sensitivity_level,
      route_type: routingRecommendation.route_type,
      triageItemId: triageItem?.id ?? null,
    };
  }

  // Eligible — log intent before attempting the webhook call
  await logEvent({
    ...baseAudit,
    eventType: "slack_post_eligible",
    action: "Email eligible for shared Slack escalation",
    reason: eligibility.reason,
  });

  // Create triage item BEFORE building the message so its ID can be embedded in buttons.
  // Errors are swallowed — a triage failure must not block the Slack alert.
  let triageItemId: string | null = null;
  try {
    const triageItem = await createTriageItemFromContext(
      { email, classification, routingRecommendation },
      { slackAction: "posted", slackChannel: channelName ?? null }
    );
    triageItemId = triageItem?.id ?? null;
  } catch (err) {
    console.error(`[slack] triage item pre-creation failed for email=${inboundEmailId}:`, err);
  }

  const message = buildSlackEscalationMessage(ctx, triageItemId);

  let webhookResult: { status: number; body: string };
  try {
    webhookResult = await sendToWebhook(message);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await logEvent({
      ...baseAudit,
      eventType: "slack_post_failed",
      action: "Slack webhook call failed",
      reason: errorMessage,
    });
    console.error(`[slack] webhook call failed email=${inboundEmailId}:`, errorMessage);
    throw err;
  }

  const success = webhookResult.status === 200 && webhookResult.body === "ok";

  if (success) {
    await logEvent({
      ...baseAudit,
      eventType: "slack_post_created",
      action: "Slack escalation alert sent successfully",
      metadata: {
        webhook_status: webhookResult.status,
        ...(channelName ? { channel_name: channelName } : {}),
      },
    });
    console.log(
      `[slack] posted email=${inboundEmailId} status=${webhookResult.status}` +
      (channelName ? ` channel=#${channelName}` : "")
    );
  } else {
    await logEvent({
      ...baseAudit,
      eventType: "slack_post_failed",
      action: "Slack webhook returned non-ok response",
      reason: `status=${webhookResult.status} body=${webhookResult.body}`,
      metadata: {
        webhook_status: webhookResult.status,
        webhook_body: webhookResult.body,
        ...(channelName ? { channel_name: channelName } : {}),
      },
    });
    console.error(
      `[slack] post failed email=${inboundEmailId} ` +
      `status=${webhookResult.status} body=${webhookResult.body}`
    );
  }

  return {
    eligible: true,
    action: "posted",
    reason: eligibility.reason,
    urgency_level: classification.urgency_level,
    sensitivity_level: classification.sensitivity_level,
    route_type: routingRecommendation.route_type,
    ...(channelName ? { channel_name: channelName } : {}),
    webhookStatus: webhookResult.status,
    slackResponse: webhookResult.body,
    triageItemId,
  };
}
