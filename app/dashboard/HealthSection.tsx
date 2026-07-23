"use client";

import { useEffect, useState, useCallback } from "react";
import styles from "./dashboard.module.css";
import { formatTorontoDateTime } from "@/src/lib/formatDate";
import type { DashboardHealth, HealthCheck } from "@/src/services/dashboardHealth";

interface Props {
  // Timestamp (ISO) of the dashboard's last successful data refresh.
  lastRefreshAt: string | null;
}

const LEVEL_CLASS: Record<string, string> = {
  ok: "healthOk",
  warn: "healthWarn",
  crit: "healthCrit",
};

export default function HealthSection({ lastRefreshAt }: Props) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<DashboardHealth | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/dashboard/health");
      const json = (await res.json()) as { ok?: boolean; health?: DashboardHealth; error?: string };
      if (!res.ok || !json.ok || !json.health) {
        setErrorMsg(json.error ?? `HTTP ${res.status}`);
        setState("error");
        return;
      }
      setHealth(json.health);
      setState("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setState("error");
    }
  }, []);

  // Load when first expanded; refresh every 2 minutes while open.
  useEffect(() => {
    if (!open) return;
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, [open, load]);

  const overall = health?.overall ?? "ok";
  const overallDot =
    overall === "crit" ? styles.healthDotCrit : overall === "warn" ? styles.healthDotWarn : styles.healthDotOk;

  return (
    <div className={styles.healthWrap}>
      <button
        className={styles.healthToggle}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className={`${styles.healthDot} ${overallDot}`} />
        System health
        <span className={styles.healthToggleChevron}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className={styles.healthPanel}>
          {state === "loading" && !health && <div className={styles.timelineMuted}>Loading health…</div>}
          {state === "error" && <div className={styles.timelineError}>Could not load health: {errorMsg}</div>}

          {health && (
            <>
              <div className={styles.healthGrid}>
                {health.checks.map(check => (
                  <HealthCard key={check.key} check={check} />
                ))}
                <div className={`${styles.healthCard} ${styles.healthOk}`}>
                  <div className={styles.healthCardHead}>
                    <span className={styles.healthCardLabel}>Dashboard refresh</span>
                    <span className={styles.healthBadgeOk}>ok</span>
                  </div>
                  <div className={styles.healthCardValue}>
                    {lastRefreshAt ? formatTorontoDateTime(lastRefreshAt) : "—"}
                  </div>
                  <div className={styles.healthCardDetail}>Last successful dashboard data refresh.</div>
                </div>
              </div>
              <div className={styles.healthFooter}>
                Updated {formatTorontoDateTime(health.generatedAt)} ·{" "}
                <button className={styles.healthRefreshBtn} onClick={load} disabled={state === "loading"}>
                  Refresh
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function HealthCard({ check }: { check: HealthCheck }) {
  const cls = styles[LEVEL_CLASS[check.level] as keyof typeof styles] as string;
  const badgeCls =
    check.level === "crit" ? styles.healthBadgeCrit : check.level === "warn" ? styles.healthBadgeWarn : styles.healthBadgeOk;
  return (
    <div className={`${styles.healthCard} ${cls}`}>
      <div className={styles.healthCardHead}>
        <span className={styles.healthCardLabel}>{check.label}</span>
        <span className={badgeCls}>{check.level}</span>
      </div>
      <div className={styles.healthCardValue}>{check.value}</div>
      <div className={styles.healthCardDetail}>{check.detail}</div>
      {check.action && <div className={styles.healthCardAction}>→ {check.action}</div>}
    </div>
  );
}
