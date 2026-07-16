"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { usePathname } from "next/navigation";
import FilterBar from "./FilterBar";
import TriageTable from "./TriageTable";
import ViewTabs from "./ViewTabs";
import AgentRunsTable from "./AgentRunsTable";
import { computeCounts } from "./utils";
import type { DashboardView, SerializedAgentRun, SerializedTriageItem } from "./types";
import styles from "./dashboard.module.css";

// ── Client-side filtering ──────────────────────────────────────────────────────

function filterItems(
  all: SerializedTriageItem[],
  team: string,
  search: string
): SerializedTriageItem[] {
  let items = all;
  const CLOSED = ["resolved", "archived", "ignored"] as const;

  if (team === "archived") {
    items = items.filter(i => i.status === "archived");
  } else if (team === "resolved") {
    items = items.filter(i => i.status === "resolved");
  } else if (team === "manual_review") {
    items = items.filter(i => i.status === "manual_review");
  } else if (team === "urgent_open") {
    items = items.filter(
      i => i.urgency_level === "urgent" && !(CLOSED as readonly string[]).includes(i.status)
    );
  } else if (team === "assigned") {
    items = items.filter(i => i.status === "assigned" || i.status === "escalated");
  } else if (["operations", "engineering", "customer_success", "field_ops"].includes(team)) {
    items = items.filter(
      i =>
        i.recommended_owner === team &&
        !(CLOSED as readonly string[]).includes(i.status)
    );
  } else {
    items = items.filter(i => !(CLOSED as readonly string[]).includes(i.status));
  }

  if (search.trim()) {
    const q = search.toLowerCase();
    items = items.filter(
      i =>
        i.subject?.toLowerCase().includes(q) ||
        i.sender_email?.toLowerCase().includes(q) ||
        i.sender_name?.toLowerCase().includes(q) ||
        i.summary?.toLowerCase().includes(q)
    );
  }

  return items;
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  alert,
  positive,
}: {
  label: string;
  value: number | string;
  alert?: boolean;
  positive?: boolean;
}) {
  let cls = styles.statCard;
  if (alert)    cls += ` ${styles.statAlert}`;
  if (positive) cls += ` ${styles.statPositive}`;
  return (
    <div className={cls}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function parseView(raw: string): DashboardView {
  return raw === "agent" ? "agent" : "queue";
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  initialItems: SerializedTriageItem[];
  initialAgentRuns: SerializedAgentRun[];
  initialView: string;
  initialTeam: string;
  initialSearch: string;
  hasDbError: boolean;
  dbErrorMessage: string | null;
}

export default function DashboardClient({
  initialItems,
  initialAgentRuns,
  initialView,
  initialTeam,
  initialSearch,
  hasDbError,
  dbErrorMessage,
}: Props) {
  const pathname = usePathname();

  const [activeView, setActiveView] = useState<DashboardView>(parseView(initialView));
  const [activeTeam, setActiveTeam] = useState(initialTeam);
  const [search,     setSearch]     = useState(initialSearch);
  const [allItems,   setAllItems]   = useState(initialItems);
  const [agentRuns,  setAgentRuns]  = useState(initialAgentRuns);
  const [refreshError, setRefreshError] = useState<string | null>(
    hasDbError ? (dbErrorMessage ?? "Failed to load dashboard data") : null
  );
  const refreshingRef = useRef(false);

  // Counts are derived from allItems — no second DB query needed.
  const counts = useMemo(() => computeCounts(allItems), [allItems]);

  const agentStats = useMemo(() => {
    const failed = agentRuns.filter(r => r.status === "failed").length;
    const lowConfidence = agentRuns.filter(
      r => r.confidence_score != null && r.confidence_score < 0.7
    ).length;
    const needsReview = agentRuns.filter(r => r.needs_manual_review === true).length;
    const success = agentRuns.filter(r => r.status === "success").length;
    return { failed, lowConfidence, needsReview, success, total: agentRuns.length };
  }, [agentRuns]);

  // When DashboardHeaderActions triggers router.refresh() (after an email sync),
  // the server re-renders and new initialItems arrive via props.
  // Only accept them when the server fetch succeeded — on DB error, keep the
  // current items visible (last-known-good data).
  useEffect(() => {
    if (!hasDbError) {
      setAllItems(initialItems);
      setAgentRuns(initialAgentRuns);
      setRefreshError(null);
      console.log(
        `[dashboard] server refresh received items=${initialItems.length} runs=${initialAgentRuns.length}`
      );
    } else {
      console.warn("[dashboard] server refresh returned DB error — keeping last-known-good data");
      setRefreshError(dbErrorMessage ?? "Refresh failed — showing last known data");
    }
  }, [initialItems, initialAgentRuns, hasDbError, dbErrorMessage]);

  // Fetches fresh data from the API endpoint without a full server re-render.
  // Used for 60s polling and post-action refreshes.
  const fetchFreshData = useCallback(async () => {
    if (refreshingRef.current) {
      console.log("[dashboard] refresh already in progress, skipping");
      return;
    }
    refreshingRef.current = true;
    console.log("[dashboard] API fetch started");
    try {
      const [queueRes, agentRes] = await Promise.all([
        fetch("/api/dashboard/data"),
        fetch("/api/dashboard/agent/runs"),
      ]);

      if (queueRes.status === 401 || agentRes.status === 401) {
        // Session expired — send the operator back to login.
        window.location.href = "/dashboard/login";
        return;
      }
      if (!queueRes.ok) throw new Error(`Queue HTTP ${queueRes.status}`);
      if (!agentRes.ok) throw new Error(`Agent HTTP ${agentRes.status}`);

      const queuePayload = await queueRes.json() as {
        ok: boolean;
        items?: SerializedTriageItem[];
        error?: string;
      };
      const agentPayload = await agentRes.json() as {
        ok: boolean;
        runs?: SerializedAgentRun[];
        error?: string;
      };

      if (!queuePayload.ok || !queuePayload.items) {
        throw new Error(queuePayload.error ?? "No queue data");
      }
      if (!agentPayload.ok || !agentPayload.runs) {
        throw new Error(agentPayload.error ?? "No agent data");
      }

      setAllItems(queuePayload.items);
      setAgentRuns(agentPayload.runs);
      setRefreshError(null);
      console.log(
        `[dashboard] API fetch completed items=${queuePayload.items.length} runs=${agentPayload.runs.length}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[dashboard] API fetch failed:", msg);
      // Do NOT clear allItems — keep whatever was last successfully loaded.
      setRefreshError("Refresh failed — showing last known data");
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  // 60s polling — picks up Slack-side changes and new incoming emails.
  useEffect(() => {
    const id = setInterval(fetchFreshData, 60_000);
    return () => clearInterval(id);
  }, [fetchFreshData]);

  // Update the URL so tabs are bookmarkable and back-button works, but use
  // window.history.replaceState instead of router.replace so that Next.js does
  // NOT treat it as a navigation — avoiding a full server re-render (and extra
  // DB queries) on every search keystroke or tab switch.
  const updateUrl = useCallback(
    (view: DashboardView, team: string, q: string) => {
      const p = new URLSearchParams();
      if (view !== "queue") p.set("view", view);
      if (team && team !== "all") p.set("team", team);
      if (q.trim()) p.set("search", q.trim());
      const qs = p.toString();
      window.history.replaceState(null, "", `${pathname}${qs ? "?" + qs : ""}`);
    },
    [pathname]
  );

  function handleViewChange(view: DashboardView) {
    setActiveView(view);
    updateUrl(view, activeTeam, search);
  }

  function handleTeamChange(team: string) {
    setActiveTeam(team);
    updateUrl(activeView, team, search);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    updateUrl(activeView, activeTeam, value);
  }

  function handleItemUpdated(updated: SerializedTriageItem) {
    setAllItems(prev =>
      prev.map(i => (i.id === updated.id ? { ...i, ...updated } : i))
    );
  }

  // Called after status-changing actions — fetches fresh data via API so counts
  // update promptly without a full server re-render.
  function handleRefresh() {
    fetchFreshData();
  }

  const items = filterItems(allItems, activeTeam, search);

  const openItems    = allItems.filter(i => !["resolved", "archived", "ignored"].includes(i.status));
  const oldestOpenMs = openItems.length > 0
    ? Math.max(
        ...openItems
          .filter(i => i.status === "new")
          .map(i => Date.now() - new Date(i.created_at).getTime()),
        0
      )
    : 0;

  return (
    <>
      {refreshError && (
        <div className={styles.refreshErrorBanner}>
          <span>⚠ {refreshError}</span>
          <button
            className={styles.refreshErrorDismiss}
            onClick={() => setRefreshError(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <ViewTabs
        activeView={activeView}
        agentCount={agentRuns.length}
        onViewChange={handleViewChange}
      />

      {activeView === "queue" ? (
        <>
          <div className={styles.statsGrid}>
            <StatCard label="Total Open"     value={counts.all} />
            <StatCard label="Urgent Open"    value={counts.urgent_open} alert={counts.urgent_open > 0} />
            <StatCard label="Manual Review"  value={counts.manual_review} alert={counts.manual_review > 0} />
            <StatCard label="Resolved"       value={counts.resolved} positive />
            <StatCard
              label="Oldest Unresolved"
              value={oldestOpenMs > 0 ? formatAge(oldestOpenMs) : "—"}
              alert={oldestOpenMs > 86_400_000}
            />
          </div>

          <section className={styles.section}>
            <FilterBar
              counts={counts}
              activeTeam={activeTeam}
              search={search}
              onTeamChange={handleTeamChange}
              onSearchChange={handleSearchChange}
            />
            <TriageTable
              items={items}
              onItemUpdated={handleItemUpdated}
              onRefresh={handleRefresh}
            />
          </section>
        </>
      ) : (
        <>
          <div className={styles.statsGrid}>
            <StatCard label="Recent Runs" value={agentStats.total} />
            <StatCard label="Succeeded" value={agentStats.success} positive />
            <StatCard
              label="Failed"
              value={agentStats.failed}
              alert={agentStats.failed > 0}
            />
            <StatCard
              label="Low Confidence"
              value={agentStats.lowConfidence}
              alert={agentStats.lowConfidence > 0}
            />
            <StatCard
              label="Needs Review"
              value={agentStats.needsReview}
              alert={agentStats.needsReview > 0}
            />
          </div>

          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              Triage Agent
              <span className={styles.sectionCount}>Classification runs</span>
            </div>
            <AgentRunsTable
              runs={agentRuns}
              search={search}
              onSearchChange={handleSearchChange}
            />
          </section>
        </>
      )}
    </>
  );
}
