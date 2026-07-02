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

export default function DashboardHeaderActions() {
  const router = useRouter();
  const [operator,  setOperator]  = useState<OperatorInfo | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

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
