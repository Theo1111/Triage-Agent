"use client";

import type { SerializedAgentRun } from "./types";
import styles from "./dashboard.module.css";
import { formatCategoryLabel } from "@/src/lib/formatCategory";
import { formatTorontoDateTime } from "@/src/lib/formatDate";

interface Props {
  run: SerializedAgentRun | null;
  onClose: () => void;
}

function fmtDate(iso: string | null): string {
  return formatTorontoDateTime(iso);
}

function fmtConfidence(score: number | null): string {
  if (score == null) return "—";
  return `${Math.round(score * 100)}%`;
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className={styles.drawerMuted}>—</span>;
  return (
    <div className={styles.agentChipList}>
      {items.map(item => (
        <span key={item} className={styles.agentChip}>{item}</span>
      ))}
    </div>
  );
}

export default function AgentRunDrawer({ run, onClose }: Props) {
  if (!run) return null;

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} />
      <div className={styles.drawerPanel}>
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>
            {run.subject ?? <em>No subject</em>}
          </div>
          <button className={styles.drawerClose} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.drawerActions}>
          <a
            className={`${styles.drawerBtn} ${styles.drawerBtnLink}`}
            href={`/emails/${run.inbound_email_id}`}
          >
            View Email
          </a>
        </div>

        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>Run</div>
          <DrawerField label="Status">{run.status.replace(/_/g, " ")}</DrawerField>
          <DrawerField label="Model">{run.model_name ?? "—"}</DrawerField>
          <DrawerField label="Prompt">{run.prompt_version ?? "—"}</DrawerField>
          <DrawerField label="Started">{fmtDate(run.started_at)}</DrawerField>
          <DrawerField label="Finished">{fmtDate(run.finished_at)}</DrawerField>
          <DrawerField label="Tokens">
            {run.total_tokens != null
              ? `${run.total_tokens} total` +
                (run.input_tokens != null || run.output_tokens != null
                  ? ` (${run.input_tokens ?? "—"} in / ${run.output_tokens ?? "—"} out)`
                  : "")
              : "—"}
          </DrawerField>
          {run.error_message && (
            <DrawerField label="Error">
              <span className={styles.agentErrorText}>{run.error_message}</span>
            </DrawerField>
          )}
        </div>

        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>Email</div>
          <DrawerField label="From">
            {run.sender_name ? `${run.sender_name} ` : ""}
            <span className={styles.drawerMuted}>{run.sender_email ?? "—"}</span>
          </DrawerField>
          <DrawerField label="Inbox">{run.source_inbox_email ?? "—"}</DrawerField>
          {run.snippet && <DrawerField label="Snippet">{run.snippet}</DrawerField>}
        </div>

        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>Agent Classification</div>
          <DrawerField label="Confidence">{fmtConfidence(run.confidence_score)}</DrawerField>
          <DrawerField label="Urgency">{run.urgency_level?.replace(/_/g, " ") ?? "—"}</DrawerField>
          {run.urgency_reason && <DrawerField label="Urgency reason">{run.urgency_reason}</DrawerField>}
          <DrawerField label="Sensitivity">
            {run.sensitivity_level?.replace(/_/g, " ") ?? "—"}
          </DrawerField>
          {run.sensitivity_reason && (
            <DrawerField label="Sensitivity reason">{run.sensitivity_reason}</DrawerField>
          )}
          <DrawerField label="Category">{formatCategoryLabel(run.primary_category)}</DrawerField>
          <DrawerField label="Owner">{run.recommended_owner?.replace(/_/g, " ") ?? "—"}</DrawerField>
          <DrawerField label="Route">{run.route_type?.replace(/_/g, " ") ?? "—"}</DrawerField>
          <DrawerField label="Summary">{run.summary ?? "—"}</DrawerField>
          {run.recommended_next_step && (
            <DrawerField label="Next step">{run.recommended_next_step}</DrawerField>
          )}
          {run.category_tags.length > 0 && (
            <DrawerField label="Tags">
              <ChipList items={run.category_tags} />
            </DrawerField>
          )}
        </div>

        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>Diagnostics</div>
          <DrawerField label="Manual review">
            {run.needs_manual_review == null ? "—" : run.needs_manual_review ? "Yes" : "No"}
          </DrawerField>
          <DrawerField label="Operational impact">
            {run.operational_impact_detected == null
              ? "—"
              : run.operational_impact_detected
                ? "Yes"
                : "No"}
          </DrawerField>
          {run.impact_reasoning && (
            <DrawerField label="Impact reasoning">{run.impact_reasoning}</DrawerField>
          )}
          {run.safe_slack_summary && (
            <DrawerField label="Safe Slack summary">{run.safe_slack_summary}</DrawerField>
          )}
          <DrawerField label="Vocabulary matches">
            <ChipList items={run.matched_vocabulary_terms} />
          </DrawerField>
          <DrawerField label="Language signals">
            <ChipList items={run.human_language_signals} />
          </DrawerField>
        </div>

        {(run.triage_item_id || run.triage_status) && (
          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionTitle}>Queue</div>
            <DrawerField label="Triage status">
              {run.triage_status?.replace(/_/g, " ") ?? "—"}
            </DrawerField>
          </div>
        )}
      </div>
    </>
  );
}

function DrawerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.drawerField}>
      <span className={styles.drawerLabel}>{label}</span>
      <span className={styles.drawerValue}>{children}</span>
    </div>
  );
}
