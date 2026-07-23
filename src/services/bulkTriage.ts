// Bulk triage actions. Each item is processed independently so a partial
// failure never aborts the batch — the caller gets a per-case result and can
// show an accurate success/failure summary. Every change reuses the same
// single-item service transitions, audit logging, and Slack sync as the
// individual endpoints, so bulk and single-item behaviour cannot diverge.

import {
  assignTriageItem,
  escalateTriageItem,
  resolveTriageItem,
  archiveTriageItem,
} from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";
import { resolveAssignmentOwner } from "@/src/lib/assignmentOwner";
import type { OperatorProfilePublic } from "@/src/services/operatorProfiles";
import type { TriageItem } from "@/src/types/database";

export type BulkAction = "assign_self" | "assign" | "escalate" | "resolve" | "archive";

export interface BulkActionInput {
  action: BulkAction;
  triageItemIds: string[];
  // Required when action === "assign".
  owner?: { kind: "operator" | "team"; value: string };
  operator: OperatorProfilePublic;
}

export interface BulkItemResult {
  triageItemId: string;
  ok: boolean;
  error?: string;
}

export interface BulkActionResult {
  results: BulkItemResult[];
  successCount: number;
  failureCount: number;
}

const MAX_BULK = 200;

export async function runBulkAction(input: BulkActionInput): Promise<BulkActionResult> {
  const { action, operator } = input;
  const ids = [...new Set(input.triageItemIds.filter(Boolean))];
  if (ids.length === 0) throw new Error("no_items: triageItemIds is required");
  if (ids.length > MAX_BULK) throw new Error(`too_many: at most ${MAX_BULK} items per bulk action`);

  const actorLabel = operator.displayName ?? operator.username;

  // Resolve the assignment owner once (fail fast before mutating anything).
  let resolvedOwner: { owner: string; label: string } | null = null;
  if (action === "assign_self") {
    resolvedOwner = await resolveAssignmentOwner({ ownerKind: "self", actingOperator: operator });
  } else if (action === "assign") {
    if (!input.owner) throw new Error("owner_required: assign needs an owner");
    resolvedOwner = await resolveAssignmentOwner({
      ownerKind: input.owner.kind,
      owner: input.owner.value,
      actingOperator: operator,
    });
  }

  const results: BulkItemResult[] = [];

  for (const id of ids) {
    try {
      let item: TriageItem;
      let statusLine: string;
      let eventType: string;
      let actionText: string;

      switch (action) {
        case "assign_self":
        case "assign": {
          item = await assignTriageItem(id, resolvedOwner!.owner);
          statusLine = `✅ *Status:* Assigned to ${resolvedOwner!.label} by ${actorLabel} (via dashboard)`;
          eventType = "dashboard_owner_changed";
          actionText = `Bulk-assigned triage item ${id} to ${resolvedOwner!.label} (by ${actorLabel})`;
          break;
        }
        case "escalate": {
          item = await escalateTriageItem(id);
          statusLine = `🔺 *Status:* Escalated by ${actorLabel} (via dashboard)`;
          eventType = "dashboard_item_escalated";
          actionText = `Bulk-escalated triage item ${id} (by ${actorLabel})`;
          break;
        }
        case "resolve": {
          item = await resolveTriageItem(id);
          statusLine = `🟢 *Status:* Resolved by ${actorLabel} (via dashboard)`;
          eventType = "dashboard_item_resolved";
          actionText = `Bulk-resolved triage item ${id} (by ${actorLabel})`;
          break;
        }
        case "archive": {
          item = await archiveTriageItem(id, operator.username, null);
          statusLine = `🗄️ *Status:* Archived by ${actorLabel} (via dashboard)`;
          eventType = "dashboard_item_archived";
          actionText = `Bulk-archived triage item ${id} (by ${actorLabel})`;
          break;
        }
        default:
          throw new Error(`invalid_action: ${action}`);
      }

      await logEvent({
        inboundEmailId: item.inbound_email_id,
        eventType,
        actorType: "human",
        actorId: operator.username,
        action: actionText,
        afterState: resolvedOwner ? { owner: resolvedOwner.owner } : undefined,
        metadata: { bulk: true },
      });

      // Slack sync is best-effort — a Slack hiccup must not fail the case.
      try {
        await syncTriageItemToSlack(item, statusLine);
      } catch (slackErr) {
        console.error(`[bulkTriage] slack sync failed for ${id}:`, slackErr);
      }

      results.push({ triageItemId: id, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push({ triageItemId: id, ok: false, error: msg });
    }
  }

  const successCount = results.filter(r => r.ok).length;
  return { results, successCount, failureCount: results.length - successCount };
}
