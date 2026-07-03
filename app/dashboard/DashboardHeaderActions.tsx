"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./dashboard.module.css";

interface OperatorInfo {
  id: string;
  username: string;
  displayName: string | null;
}

type SyncStatus = "idle" | "syncing" | "done" | "error";

export default function DashboardHeaderActions() {
  const router = useRouter();
  const [operator,    setOperator]    = useState<OperatorInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [loggingOut,  setLoggingOut]  = useState(false);
  const [syncStatus,  setSyncStatus]  = useState<SyncStatus>("idle");
  const [syncMessage, setSyncMessage] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/operators/me")
      .then(r => r.json())
      .then(d => setOperator(d.operator ?? null))
      .catch(() => setOperator(null))
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/dashboard/operators/logout", { method: "POST" }).catch(() => {});
    router.push("/dashboard/login");
  }

  async function handleRefreshEmails() {
    if (syncStatus === "syncing") return;
    setSyncStatus("syncing");
    setSyncMessage("");
    try {
      const res  = await fetch("/api/gmail/sync", { method: "POST" });
      const data = await res.json() as { ok: boolean; summary?: string; error?: string };
      setSyncStatus(data.ok ? "done" : "error");
      setSyncMessage(data.summary ?? data.error ?? (data.ok ? "Done." : "Sync failed."));
      // Refresh the dashboard data after a successful sync.
      if (data.ok) router.refresh();
    } catch {
      setSyncStatus("error");
      setSyncMessage("Network error — check server logs.");
    }
    // Clear status after 6 seconds.
    setTimeout(() => { setSyncStatus("idle"); setSyncMessage(""); }, 6_000);
  }

  if (loading) return <span className={styles.headerActionsPlaceholder} />;

  if (!operator) {
    return (
      <Link href="/dashboard/login" className={styles.headerLoginBtn}>
        Log In
      </Link>
    );
  }

  const displayLabel = operator.displayName ?? operator.username;

  return (
    <div className={styles.headerActions}>
      <span className={styles.headerOperator}>
        Operator: <strong>{displayLabel}</strong>
      </span>

      {/* Refresh Emails button — triggers manual Gmail sync */}
      <div className={styles.headerSyncWrap}>
        <button
          className={`${styles.headerSecondaryBtn} ${syncStatus === "syncing" ? styles.headerSyncBusy : ""}`}
          onClick={handleRefreshEmails}
          disabled={syncStatus === "syncing"}
          title="Renew Gmail watch and fetch any new emails"
        >
          {syncStatus === "syncing" ? "Syncing…" : "↻ Refresh Emails"}
        </button>
        {syncMessage && (
          <span className={syncStatus === "error" ? styles.headerSyncErr : styles.headerSyncOk}>
            {syncMessage}
          </span>
        )}
      </div>

      <Link href="/dashboard/login" className={styles.headerSecondaryBtn}>
        Switch
      </Link>
      <button
        className={styles.headerLoginBtn}
        onClick={handleLogout}
        disabled={loggingOut}
      >
        {loggingOut ? "…" : "Log Out"}
      </button>
    </div>
  );
}
