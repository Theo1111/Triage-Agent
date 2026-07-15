import { redirect } from "next/navigation";
import { fetchAllItemsForOperator } from "./fetchDashboardData";
import { fetchRecentAgentRuns } from "./fetchAgentRuns";
import { getOperatorFromServerCookies } from "@/src/lib/dashboardOperatorSession";
import type { SerializedAgentRun, SerializedTriageItem } from "./types";
import DashboardClient from "./DashboardClient";
import DashboardHeaderActions from "./DashboardHeaderActions";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params        = await searchParams;
  const initialView   = params.view   ?? "queue";
  const initialTeam   = params.team   ?? "";
  const initialSearch = params.search ?? "";

  // Auth gate: the dashboard contains private customer/support data.
  // Verify the HttpOnly session cookie server-side (signature + operator exists
  // in DB) and redirect unauthenticated visitors to the login page. Fail closed:
  // any resolution failure counts as unauthenticated.
  const operator = await getOperatorFromServerCookies();
  if (!operator) {
    console.warn("[dashboard] auth required — redirecting to /dashboard/login");
    redirect("/dashboard/login");
  }
  const operatorId = operator.id;

  let allItems: SerializedTriageItem[] = [];
  let agentRuns: SerializedAgentRun[] = [];
  let dbError: string | null = null;

  try {
    [allItems, agentRuns] = await Promise.all([
      fetchAllItemsForOperator(operatorId),
      fetchRecentAgentRuns(200),
    ]);
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown database error";
    dbError = raw.includes("operator_profiles") || raw.includes("42P01")
      ? "Operator profile storage is not set up yet. Please run the operator_profiles migration."
      : raw;
    console.error("[dashboard] SSR fetch failed:", raw);
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Triage Dashboard</h1>
          <p className={styles.subtitle}>Grata / Speer Operations Intelligence</p>
        </div>
        <DashboardHeaderActions />
      </header>

      <DashboardClient
        initialItems={allItems}
        initialAgentRuns={agentRuns}
        initialView={initialView}
        initialTeam={initialTeam}
        initialSearch={initialSearch}
        hasDbError={!!dbError}
        dbErrorMessage={dbError}
      />
    </div>
  );
}
