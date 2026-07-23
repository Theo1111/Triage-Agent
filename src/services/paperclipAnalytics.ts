// Safe aggregate analytics for the Paperclip integration. Returns ONLY
// non-sensitive counts and rates over a bounded time window — never email
// bodies, senders, tokens, or raw model output.

import { query, queryOne } from "@/src/lib/db";
import * as auditRepo from "@/src/repositories/agentAuditLogsRepository";
import * as correctionsRepo from "@/src/repositories/humanCorrectionsRepository";
import { ensureTriageSchema } from "@/src/lib/ensureTriageSchema";

export interface PaperclipAnalytics {
  windowDays: number;
  generatedAt: string;
  emails: {
    classified: number;
    awaitingClassification: number;
    classificationFailures: number;
    classificationSuccessRate: number;
  };
  triage: {
    activeTotal: number;
    manualReview: number;
    teamCounts: Record<string, number>;
  };
  slack: {
    delivered: number;
    failed: number;
    deliverySuccessRate: number;
  };
  quality: {
    corrections: number;
    correctionRate: number;
    falsePositives: number; // AI said actionable, corrected to irrelevant
    falseNegatives: number; // AI said irrelevant, corrected to actionable
    urgencyCorrections: number;
    sensitivityCorrections: number;
  };
}

function clampDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 7;
  return Math.min(90, Math.floor(days));
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const row = await queryOne<{ count: string }>(sql, params);
  return Number(row?.count ?? 0);
}

export async function getPaperclipAnalytics(daysInput = 7): Promise<PaperclipAnalytics> {
  await ensureTriageSchema();
  const windowDays = clampDays(daysInput);
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);

  const [
    classified,
    awaiting,
    failuresRuns,
    successRuns,
    totalRuns,
    activeTotal,
    manualReview,
    delivered,
    failedSlack,
  ] = await Promise.all([
    count(`SELECT COUNT(*)::text AS count FROM inbound_emails WHERE processing_status = 'classification_ready' AND created_at >= $1`, [since]),
    count(`SELECT COUNT(*)::text AS count FROM inbound_emails WHERE processing_status = 'awaiting_classification'`, []),
    count(`SELECT COUNT(*)::text AS count FROM classification_runs WHERE status = 'failed' AND started_at >= $1`, [since]),
    count(`SELECT COUNT(*)::text AS count FROM classification_runs WHERE status = 'success' AND started_at >= $1`, [since]),
    count(`SELECT COUNT(*)::text AS count FROM classification_runs WHERE started_at >= $1`, [since]),
    count(`SELECT COUNT(*)::text AS count FROM triage_items WHERE superseded_by_triage_item_id IS NULL AND status NOT IN ('resolved','archived','ignored')`, []),
    count(`SELECT COUNT(*)::text AS count FROM triage_items WHERE status = 'manual_review' AND superseded_by_triage_item_id IS NULL`, []),
    auditRepo.countByEventTypesSince(["slack_post_created"], since),
    auditRepo.countByEventTypesSince(["slack_post_failed"], since),
  ]);

  // Team distribution across active cases (recommended_owner from classification).
  const teamRows = await query<{ owner: string | null; count: string }>(
    `SELECT ec.recommended_owner AS owner, COUNT(*)::text AS count
     FROM triage_items ti
     LEFT JOIN email_classifications ec ON ec.id = ti.classification_id
     WHERE ti.superseded_by_triage_item_id IS NULL
       AND ti.status NOT IN ('resolved','archived','ignored')
     GROUP BY ec.recommended_owner`,
    []
  );
  const teamCounts: Record<string, number> = {};
  for (const r of teamRows) teamCounts[r.owner ?? "unassigned"] = Number(r.count);

  // Correction-derived quality signals.
  const corr = await correctionsRepo.correctionAnalytics().catch(() => null);
  const falsePositives = await count(
    `SELECT COUNT(*)::text AS count FROM human_classification_corrections WHERE relevance = 'irrelevant' AND created_at >= $1`,
    [since]
  ).catch(() => 0);
  const falseNegatives = await count(
    `SELECT COUNT(*)::text AS count FROM human_classification_corrections WHERE relevance = 'actionable' AND created_at >= $1`,
    [since]
  ).catch(() => 0);

  const correctionsCount = corr?.total ?? 0;

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    emails: {
      classified,
      awaitingClassification: awaiting,
      classificationFailures: failuresRuns,
      classificationSuccessRate: totalRuns === 0 ? 1 : successRuns / totalRuns,
    },
    triage: { activeTotal, manualReview, teamCounts },
    slack: {
      delivered,
      failed: failedSlack,
      deliverySuccessRate: delivered + failedSlack === 0 ? 1 : delivered / (delivered + failedSlack),
    },
    quality: {
      corrections: correctionsCount,
      correctionRate: classified === 0 ? 0 : correctionsCount / classified,
      falsePositives,
      falseNegatives,
      urgencyCorrections: corr?.urgencyCorrections ?? 0,
      sensitivityCorrections: corr?.sensitivityCorrections ?? 0,
    },
  };
}
