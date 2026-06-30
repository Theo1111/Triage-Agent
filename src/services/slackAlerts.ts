import { env } from "@/src/config/env";
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

const CATEGORY_LABELS: Record<string, string> = {
  app_or_software:            "App / Software",
  field_ops:                  "Field Ops",
  access_or_lockout:          "Access / Lockout",
  ict_or_intercom:            "ICT / Intercom",
  hardware_or_device:         "Hardware / Device",
  cameras_or_security_video:  "Cameras / Security Video",
  customer_escalation:        "Customer Escalation",
  engineering_blocker:        "Engineering Blocker",
  building_infrastructure:    "Building Infrastructure",
  sensitive_private:          "Sensitive / Private",
  not_relevant:               "Not Relevant",
};

export function formatCategoryLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (CATEGORY_LABELS[value]) return CATEGORY_LABELS[value];
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

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
  const viewEmailUrl = appBaseUrl ? `${appBaseUrl}/dashboard` : null;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🚨 Urgent Email Alert", emoji: true },
    },
    // Top metadata: subject, category, owner at a glance
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Subject:* ${subject}\n` +
          `*Category:* ${category}\n` +
          `*Owner:* Unassigned`,
      },
    },
    // Triage status block
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🚦 *Triage status*\n*Status:* New\n*Last action:* Alert received`,
      },
    },
  ];

  // Action buttons — prominent, before email details
  if (triageItemId) {
    const elements: unknown[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "Assign to me", emoji: false },
        action_id: "triage_assign_to_me",
        value: triageItemId,
        style: "primary",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Route / Notify", emoji: false },
        action_id: "triage_route_open_modal",
        value: triageItemId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Resolved", emoji: false },
        action_id: "triage_resolve",
        value: triageItemId,
      },
    ];
    if (viewEmailUrl) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "View Email", emoji: false },
        url: viewEmailUrl,
      });
    }
    blocks.push({ type: "actions", elements });
  }

  // Email details
  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*From:*\n${senderDisplay}` },
      { type: "mrkdwn", text: `*To:*\n${e.source_inbox_email}` },
    ],
  });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Summary:*\n${summary}` },
  });

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
  const viewEmailUrl = appBaseUrl ? `${appBaseUrl}/dashboard` : null;

  const viewEmailButton = viewEmailUrl
    ? {
        type: "button",
        text: { type: "plain_text", text: "View Email", emoji: false },
        url: viewEmailUrl,
      }
    : null;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🚨 Urgent Email Alert", emoji: true },
    },
    // Top metadata: subject, category, owner at a glance
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Subject:* ${subject}\n` +
          `*Category:* ${category}\n` +
          `*Owner:* ${owner}`,
      },
    },
    // Triage status block — Status / Last action (populated by statusText from action handler)
    {
      type: "section",
      text: { type: "mrkdwn", text: `🚦 *Triage status*\n${opts.statusText}` },
    },
  ];

  // Action buttons — status-gated, always includes View Email
  if (item.status === "resolved") {
    const elements: unknown[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "Reopen / Undo Resolved", emoji: false },
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
        text: { type: "plain_text", text: "Unassign", emoji: false },
        action_id: "triage_unassign",
        value: item.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Route / Notify", emoji: false },
        action_id: "triage_route_open_modal",
        value: item.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Resolved", emoji: false },
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
        text: { type: "plain_text", text: "Assign to me", emoji: false },
        action_id: "triage_assign_to_me",
        value: item.id,
        style: "primary",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Route / Notify", emoji: false },
        action_id: "triage_route_open_modal",
        value: item.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Resolved", emoji: false },
        action_id: "triage_resolve",
        value: item.id,
      },
    ];
    if (viewEmailButton) elements.push(viewEmailButton);
    blocks.push({ type: "actions", elements });
  }

  // Email details
  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*From:*\n${senderDisplay}` },
      { type: "mrkdwn", text: `*To:*\n${item.source_inbox_email}` },
    ],
  });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Summary:*\n${summary}` },
  });

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
