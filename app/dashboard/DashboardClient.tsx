"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { usePathname } from "next/navigation";
import FilterBar from "./FilterBar";
import TriageTable from "./TriageTable";
import ViewTabs from "./ViewTabs";
import AgentRunsTable from "./AgentRunsTable";
import BulkBar, { type BulkResultSummary } from "./BulkBar";
import HealthSection from "./HealthSection";
import { computeCounts } from "./utils";
import { isSlaBreached } from "@/src/config/sla";
import { findOperatorForOwner, type OperatorLite } from "@/src/lib/ownerDisplay";
import type {
  DashboardView,
  SerializedAgentRun,
  SerializedTriageItem,
  CurrentOperator,
} from "./types";
import styles from "./dashboard.module.css";

const CLOSED = ["resolved", "archived", "ignored"] as const;
const isClosed = (s: string) => (CLOSED as readonly string[]).includes(s);
const itemIsAssigned = (i: SerializedTriageItem) =>
  (i.owner != null && i.owner !== "") || i.assigned_at != null;
const itemIsEscalated = (i: SerializedTriageItem) =>
  i.escalated_at != null || i.status === "escalated";

function StatCard({
  label, value, alert, positive,
}: { label: string; value: number | string; alert?: boolean; positive?: boolean }) {
  let cls = styles.statCard;
  if (alert) cls += ` ${styles.statAlert}`;
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

interface Props {
  initialItems: SerializedTriageItem[];
  initialAgentRuns: SerializedAgentRun[];
  initialView: string;
  initialTeam: string;
  initialSearch: string;
  initialOwner?: string;
  currentOperator: CurrentOperator | null;
  hasDbError: boolean;
  dbErrorMessage: string | null;
}

export default function DashboardClient({
  initialItems,
  initialAgentRuns,
  initialView,
  initialTeam,
  initialSearch,
  initialOwner = "",
  currentOperator,
  hasDbError,
  dbErrorMessage,
}: Props) {
  const pathname = usePathname();

  const [activeView, setActiveView] = useState<DashboardView>(parseView(initialView));
  const [activeTeam, setActiveTeam] = useState(initialTeam);
  const [search,     setSearch]     = useState(initialSearch);
  const [ownerFilter, setOwnerFilter] = useState(initialOwner);
  const [allItems,   setAllItems]   = useState(initialItems);
  const [agentRuns,  setAgentRuns]  = useState(initialAgentRuns);
  const [operators,  setOperators]  = useState<OperatorLite[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy,   setBulkBusy]   = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResultSummary | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(
    hasDbError ? (dbErrorMessage ?? "Failed to load dashboard data") : null
  );
  const refreshingRef = useRef(false);

  // Load the operator roster once (for assignment + owner resolution/filter).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/operators")
      .then(async res => {
        if (!res.ok) return;
        const json = (await res.json()) as { profiles?: OperatorLite[] };
        if (!cancelled && json.profiles) setOperators(json.profiles);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Predicate: does this case belong to the signed-in operator?
  const matchesMe = useCallback(
    (i: SerializedTriageItem): boolean => {
      if (!currentOperator) return false;
      return !!findOperatorForOwner(i.owner, [currentOperator]);
    },
    [currentOperator]
  );

  const counts = useMemo(
    () => computeCounts(allItems, { matchesMe }),
    [allItems, matchesMe]
  );

  const agentStats = useMemo(() => {
    const failed = agentRuns.filter(r => r.status === "failed").length;
    const lowConfidence = agentRuns.filter(r => r.confidence_score != null && r.confidence_score < 0.7).length;
    const needsReview = agentRuns.filter(r => r.needs_manual_review === true).length;
    const success = agentRuns.filter(r => r.status === "success").length;
    return { failed, lowConfidence, needsReview, success, total: agentRuns.length };
  }, [agentRuns]);

  useEffect(() => {
    if (!hasDbError) {
      setAllItems(initialItems);
      setAgentRuns(initialAgentRuns);
      setRefreshError(null);
      setLastRefreshAt(new Date().toISOString());
    } else {
      setRefreshError(dbErrorMessage ?? "Refresh failed — showing last known data");
    }
  }, [initialItems, initialAgentRuns, hasDbError, dbErrorMessage]);

  const fetchFreshData = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const [queueRes, agentRes] = await Promise.all([
        fetch("/api/dashboard/data"),
        fetch("/api/dashboard/agent/runs"),
      ]);
      if (queueRes.status === 401 || agentRes.status === 401) {
        window.location.href = "/dashboard/login";
        return;
      }
      if (!queueRes.ok) throw new Error(`Queue HTTP ${queueRes.status}`);
      if (!agentRes.ok) throw new Error(`Agent HTTP ${agentRes.status}`);

      const queuePayload = (await queueRes.json()) as {
        ok: boolean; items?: SerializedTriageItem[]; error?: string;
      };
      const agentPayload = (await agentRes.json()) as {
        ok: boolean; runs?: SerializedAgentRun[]; error?: string;
      };
      if (!queuePayload.ok || !queuePayload.items) throw new Error(queuePayload.error ?? "No queue data");
      if (!agentPayload.ok || !agentPayload.runs) throw new Error(agentPayload.error ?? "No agent data");

      setAllItems(queuePayload.items);
      setAgentRuns(agentPayload.runs);
      setRefreshError(null);
      setLastRefreshAt(new Date().toISOString());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[dashboard] API fetch failed:", msg);
      setRefreshError("Refresh failed — showing last known data");
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(fetchFreshData, 60_000);
    return () => clearInterval(id);
  }, [fetchFreshData]);

  const updateUrl = useCallback(
    (view: DashboardView, team: string, q: string, owner: string) => {
      const p = new URLSearchParams();
      if (view !== "queue") p.set("view", view);
      if (team && team !== "all") p.set("team", team);
      if (q.trim()) p.set("search", q.trim());
      if (owner) p.set("owner", owner);
      const qs = p.toString();
      window.history.replaceState(null, "", `${pathname}${qs ? "?" + qs : ""}`);
    },
    [pathname]
  );

  function handleViewChange(view: DashboardView) {
    setActiveView(view);
    updateUrl(view, activeTeam, search, ownerFilter);
  }
  function handleTeamChange(team: string) {
    setActiveTeam(team);
    updateUrl(activeView, team, search, ownerFilter);
  }
  function handleSearchChange(value: string) {
    setSearch(value);
    updateUrl(activeView, activeTeam, value, ownerFilter);
  }
  function handleOwnerFilterChange(value: string) {
    setOwnerFilter(value);
    updateUrl(activeView, activeTeam, search, value);
  }

  function handleItemUpdated(updated: SerializedTriageItem) {
    setAllItems(prev => prev.map(i => (i.id === updated.id ? { ...i, ...updated } : i)));
  }
  function handleRefresh() {
    fetchFreshData();
  }

  // ── Filtering ────────────────────────────────────────────────────────────
  const items = useMemo(() => {
    let list = allItems;
    const team = activeTeam;

    if (team === "archived") list = list.filter(i => i.status === "archived");
    else if (team === "resolved") list = list.filter(i => i.status === "resolved");
    else if (team === "manual_review") list = list.filter(i => i.status === "manual_review");
    else if (team === "urgent_open") list = list.filter(i => i.urgency_level === "urgent" && !isClosed(i.status));
    else if (team === "escalated") list = list.filter(i => !isClosed(i.status) && itemIsEscalated(i));
    else if (team === "assigned") list = list.filter(i => i.status === "assigned" || i.status === "escalated");
    else if (team === "my_queue") list = list.filter(i => !isClosed(i.status) && matchesMe(i));
    else if (team === "unassigned") list = list.filter(i => !isClosed(i.status) && !itemIsAssigned(i));
    else if (team === "sla_breached") list = list.filter(i => isSlaBreached(i));
    else if (["operations", "engineering", "customer_success", "field_ops"].includes(team)) {
      list = list.filter(i => i.recommended_owner === team && !isClosed(i.status));
    } else {
      list = list.filter(i => !isClosed(i.status));
    }

    // Owner filter (applies within the current view).
    if (ownerFilter === "me") {
      list = list.filter(matchesMe);
    } else if (ownerFilter === "unassigned") {
      list = list.filter(i => !itemIsAssigned(i));
    } else if (ownerFilter) {
      const op = operators.find(o => o.username === ownerFilter);
      if (op) list = list.filter(i => !!findOperatorForOwner(i.owner, [op]));
    }

    if (search.trim()) {
      const query = search.toLowerCase();
      list = list.filter(
        i =>
          i.subject?.toLowerCase().includes(query) ||
          i.sender_email?.toLowerCase().includes(query) ||
          i.sender_name?.toLowerCase().includes(query) ||
          i.summary?.toLowerCase().includes(query)
      );
    }
    return list;
  }, [allItems, activeTeam, ownerFilter, search, operators, matchesMe]);

  // ── Oldest metrics (fixed: across all active cases, not just "new") ────────
  const now = Date.now();
  const activeItems = allItems.filter(i => !isClosed(i.status));
  const oldestActiveMs = activeItems.reduce(
    (max, i) => Math.max(max, now - new Date(i.created_at).getTime()), 0
  );
  const unassignedActive = activeItems.filter(i => !itemIsAssigned(i));
  const oldestUnassignedMs = unassignedActive.reduce(
    (max, i) => Math.max(max, now - new Date(i.created_at).getTime()), 0
  );

  // ── Bulk actions ───────────────────────────────────────────────────────────
  const clearSelection = () => setSelectedIds(new Set());

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAllVisible(ids: string[], select: boolean) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (select) ids.forEach(id => next.add(id));
      else ids.forEach(id => next.delete(id));
      return next;
    });
  }

  const runBulk = useCallback(
    async (action: string, owner?: { kind: "operator" | "team"; value: string }) => {
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      setBulkBusy(true);
      setBulkResult(null);
      try {
        const res = await fetch("/api/dashboard/triage/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, triageItemIds: ids, owner }),
        });
        if (res.status === 401) { window.location.href = "/dashboard/login"; return; }
        const json = (await res.json()) as {
          success?: boolean; successCount?: number; failureCount?: number; error?: string;
        };
        if (!res.ok || !json.success) {
          setBulkResult({ successCount: 0, failureCount: ids.length, level: "error",
            message: json.error ?? `Bulk action failed (HTTP ${res.status})` });
          return;
        }
        const successCount = json.successCount ?? 0;
        const failureCount = json.failureCount ?? 0;
        const level = failureCount === 0 ? "success" : successCount === 0 ? "error" : "partial";
        setBulkResult({
          successCount, failureCount, level,
          message:
            failureCount === 0
              ? `${successCount} case${successCount === 1 ? "" : "s"} updated`
              : `${successCount} updated, ${failureCount} failed`,
        });
        clearSelection();
        await fetchFreshData();
      } catch (err) {
        setBulkResult({ successCount: 0, failureCount: ids.length, level: "error",
          message: err instanceof Error ? err.message : "Network error" });
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, fetchFreshData]
  );

  return (
    <>
      {refreshError && (
        <div className={styles.refreshErrorBanner}>
          <span>⚠ {refreshError}</span>
          <button className={styles.refreshErrorDismiss} onClick={() => setRefreshError(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <HealthSection lastRefreshAt={lastRefreshAt} />

      <ViewTabs activeView={activeView} agentCount={agentRuns.length} onViewChange={handleViewChange} />

      {activeView === "queue" ? (
        <>
          <div className={styles.statsGrid}>
            <StatCard label="Total Open"        value={counts.all} />
            <StatCard label="Urgent Open"       value={counts.urgent_open} alert={counts.urgent_open > 0} />
            <StatCard label="Manual Review"     value={counts.manual_review} alert={counts.manual_review > 0} />
            <StatCard label="SLA Breached"      value={counts.sla_breached} alert={counts.sla_breached > 0} />
            <StatCard label="Resolved"          value={counts.resolved} positive />
            <StatCard label="Oldest Unresolved" value={oldestActiveMs > 0 ? formatAge(oldestActiveMs) : "—"} alert={oldestActiveMs > 86_400_000} />
            <StatCard label="Oldest Unassigned" value={oldestUnassignedMs > 0 ? formatAge(oldestUnassignedMs) : "—"} alert={oldestUnassignedMs > 86_400_000} />
          </div>

          <section className={styles.section}>
            <FilterBar
              counts={counts}
              activeTeam={activeTeam}
              search={search}
              operators={operators}
              currentOperator={currentOperator}
              ownerFilter={ownerFilter}
              onTeamChange={handleTeamChange}
              onSearchChange={handleSearchChange}
              onOwnerFilterChange={handleOwnerFilterChange}
            />

            <BulkBar
              count={selectedIds.size}
              operators={operators}
              busy={bulkBusy}
              result={bulkResult}
              onAssignSelf={() => runBulk("assign_self")}
              onAssignOperator={u => runBulk("assign", { kind: "operator", value: u })}
              onAssignTeam={t => runBulk("assign", { kind: "team", value: t })}
              onEscalate={() => runBulk("escalate")}
              onResolve={() => {
                if (window.confirm(`Resolve ${selectedIds.size} case(s)? They will leave the active queue.`)) runBulk("resolve");
              }}
              onArchive={() => {
                if (window.confirm(`Archive ${selectedIds.size} case(s)? They will leave the active queue.`)) runBulk("archive");
              }}
              onClear={clearSelection}
              onDismissResult={() => setBulkResult(null)}
            />

            <TriageTable
              items={items}
              operators={operators}
              currentOperator={currentOperator}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAllVisible={toggleSelectAllVisible}
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
            <StatCard label="Failed" value={agentStats.failed} alert={agentStats.failed > 0} />
            <StatCard label="Low Confidence" value={agentStats.lowConfidence} alert={agentStats.lowConfidence > 0} />
            <StatCard label="Needs Review" value={agentStats.needsReview} alert={agentStats.needsReview > 0} />
          </div>

          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              Triage Agent
              <span className={styles.sectionCount}>Classification runs</span>
            </div>
            <AgentRunsTable runs={agentRuns} search={search} onSearchChange={handleSearchChange} />
          </section>
        </>
      )}
    </>
  );
}
