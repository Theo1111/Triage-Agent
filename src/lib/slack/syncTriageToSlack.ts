import { buildSlackUpdateBlocks } from "@/src/services/slackAlerts";
import { updateSlackMessage } from "@/src/lib/slack/slackWebApi";
import { getCurrentClassification } from "@/src/services/classification";
import type { TriageItem } from "@/src/types/database";

// Syncs a triage item's state back to its original Slack card.
// No-ops silently if the item has no Slack message reference or if the bot token is absent.
export async function syncTriageItemToSlack(
  item: TriageItem,
  statusText: string
): Promise<void> {
  if (!item.slack_channel || !item.slack_message_ts) return;

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return;

  const classification = await getCurrentClassification(item.inbound_email_id).catch(
    () => null
  );

  const payload = buildSlackUpdateBlocks(item, {
    urgencyReason: classification?.urgency_reason ?? null,
    primaryCategory: classification?.primary_category ?? null,
    statusText,
  });

  try {
    await updateSlackMessage(
      botToken,
      item.slack_channel,
      item.slack_message_ts,
      payload.text,
      payload.blocks
    );
    console.log(`[slack-sync] updated card for triage=${item.id}`);
  } catch (err) {
    console.error(`[slack-sync] failed to update card for triage=${item.id}:`, err);
  }
}
