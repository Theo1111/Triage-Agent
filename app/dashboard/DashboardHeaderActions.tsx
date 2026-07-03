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
  const [operator,       setOperator]       = useState<OperatorInfo | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [loggingOut,     setLoggingOut]     = useState(false);
  const [syncStatus,     setSyncStatus]     = useState<SyncStatus>("idle");
  const [syncMessage,    setSyncMessage]    = useState("");
  const [oauthInvalid,   setOauthInvalid]   = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/dashboard/operators/me")
      .then(r => r.json())
      .then(d => setOperator(d.operator ?? null))
      .catch(() => setOperator(null))
      .finally(() => setLoading(false));

    // Check for inboxes needing OAuth reconnect.
    fetch("/api/gmail/sync/health")
      .then(r => r.json())
      .then(d => {
        const watches = (d.watchStatus ?? []) as { email: string; status: string }[];
        const broken = watches.filter(w => w.status === "oauth_invalid").map(w => w.email);
        setOauthInvalid(broken);
      })
      .catch(() => {});
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
      if (data.ok) router.refresh();
    } catch {
      setSyncStatus("error");
      setSyncMessage("Network error — check server logs.");
    }
    setTimeout(() => { setSyncStatus("idle"); setSyncMessage(""); }, 6_000);
  }

  if (loading) return <span className={styles.headerActionsPlaceholder} />;

  return (
    <>
      {oauthInvalid.length > 0 && (
        <div className={styles.oauthWarning}>
          ⚠ Gmail OAuth expired for {oauthInvalid.join(", ")} — reconnect at{" "}
          <a href="/api/auth/google" className={styles.oauthWarningLink}>
            /api/auth/google
          </a>
        </div>
      )}

      {!operator ? (
        <Link href="/dashboard/login" className={styles.headerLoginBtn}>
          Log In
        </Link>
      ) : (
        <div className={styles.headerActions}>
          <span className={styles.headerOperator}>
            Operator: <strong>{operator.displayName ?? operator.username}</strong>
          </span>

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
      )}
    </>
  );
}
