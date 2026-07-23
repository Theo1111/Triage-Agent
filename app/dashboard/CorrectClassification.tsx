"use client";

import { useEffect, useState, useCallback } from "react";
import styles from "./dashboard.module.css";
import {
  URGENCY_LEVELS,
  SENSITIVITY_LEVELS,
  PRIMARY_CATEGORIES,
  RECOMMENDED_OWNERS,
  ROUTE_TYPES,
} from "@/src/evaluation/vocabulary";
import type { EffectiveClassification } from "@/src/services/effectiveClassification";

interface Props {
  triageItemId: string;
}

type FieldKey =
  | "urgency_level"
  | "sensitivity_level"
  | "primary_category"
  | "recommended_owner"
  | "route_type";

const FIELD_OPTIONS: Record<FieldKey, readonly string[]> = {
  urgency_level: URGENCY_LEVELS,
  sensitivity_level: SENSITIVITY_LEVELS,
  primary_category: PRIMARY_CATEGORIES,
  recommended_owner: RECOMMENDED_OWNERS,
  route_type: ROUTE_TYPES,
};

const FIELD_LABEL: Record<FieldKey, string> = {
  urgency_level: "Urgency",
  sensitivity_level: "Sensitivity",
  primary_category: "Category",
  recommended_owner: "Owner/team",
  route_type: "Route",
};

// Operator classification correction — a separate human-reviewed layer over the
// AI result. Shows which fields are AI vs human-corrected.
export default function CorrectClassification({ triageItemId }: Props) {
  const [effective, setEffective] = useState<EffectiveClassification | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<FieldKey, string>>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/triage/correct?triageItemId=${encodeURIComponent(triageItemId)}`);
      const json = (await res.json()) as { ok?: boolean; effective?: EffectiveClassification };
      if (json.ok && json.effective) setEffective(json.effective);
    } catch {
      /* non-critical */
    }
  }, [triageItemId]);

  useEffect(() => {
    setEditing(false);
    setDraft({});
    setReason("");
    setError(null);
    load();
  }, [triageItemId, load]);

  async function save() {
    setError(null);
    const corrections: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) if (v) corrections[k] = v;
    if (Object.keys(corrections).length === 0) {
      setError("Change at least one field.");
      return;
    }
    if (!reason.trim()) {
      setError("A correction reason is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/dashboard/triage/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triageItemId, reason: reason.trim(), corrections }),
      });
      const json = (await res.json()) as { success?: boolean; effective?: EffectiveClassification; error?: string };
      if (!res.ok || !json.success) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      if (json.effective) setEffective(json.effective);
      setEditing(false);
      setDraft({});
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const fields: FieldKey[] = ["urgency_level", "sensitivity_level", "primary_category", "recommended_owner", "route_type"];

  return (
    <div className={styles.drawerSection}>
      <div className={styles.drawerSectionTitle}>
        Classification
        {effective?.hasHumanCorrection && <span className={styles.correctedTag}>corrected</span>}
      </div>

      {effective && !editing && (
        <>
          {fields.map(f => (
            <div className={styles.drawerField} key={f}>
              <span className={styles.drawerLabel}>{FIELD_LABEL[f]}</span>
              <span className={styles.drawerValue}>
                {String(effective[f] ?? "—").replace(/_/g, " ")}
                <span className={effective.sources[f] === "human" ? styles.srcHuman : styles.srcAi}>
                  {effective.sources[f] === "human" ? "human" : "AI"}
                </span>
              </span>
            </div>
          ))}
          <button className={styles.drawerBtnSm} onClick={() => setEditing(true)}>✎ Correct classification</button>
        </>
      )}

      {editing && (
        <div className={styles.correctForm}>
          {fields.map(f => (
            <div className={styles.drawerField} key={f}>
              <span className={styles.drawerLabel}>{FIELD_LABEL[f]}</span>
              <select
                className={styles.operatorSelect}
                value={draft[f] ?? String(effective?.[f] ?? "")}
                onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                aria-label={`Correct ${FIELD_LABEL[f]}`}
              >
                {FIELD_OPTIONS[f].map(opt => (
                  <option key={opt} value={opt}>{opt.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          ))}
          <textarea
            className={styles.drawerTextarea}
            placeholder="Reason for correction (required)…"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
          />
          {error && <div className={styles.actionError}>{error}</div>}
          <div className={styles.drawerEditActions}>
            <button className={styles.drawerBtnSm} onClick={save} disabled={busy}>{busy ? "…" : "Save correction"}</button>
            <button className={styles.drawerBtnSmCancel} onClick={() => { setEditing(false); setDraft({}); setReason(""); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {!effective && <div className={styles.timelineMuted}>Loading classification…</div>}
      {error && !editing && <div className={styles.actionError}>{error}</div>}
    </div>
  );
}
