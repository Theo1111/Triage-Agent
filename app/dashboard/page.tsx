import { cookies } from "next/headers";
import { fetchAllItemsForOperator } from "./fetchDashboardData";
import { decodeCookie } from "@/src/lib/dashboardOperatorSession";
import type { SerializedTriageItem } from "./types";
import DashboardClient from "./DashboardClient";
import DashboardHeaderActions from "./DashboardHeaderActions";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params        = await searchParams;
  const initialTeam   = params.team   ?? "";
  const initialSearch = params.search ?? "";

  // Read the operator from the HttpOnly session cookie for per-operator unread counts.
  let operatorId: string | null = null;
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("dash_op_sess")?.value;
    if (raw) operatorId = decodeCookie(raw);
  } catch {
    // Non-critical — dashboard still works without operator context.
  }

  let allItems: SerializedTriageItem[] = [];
  let dbError: string | null = null;

  try {
    allItems = await fetchAllItemsForOperator(operatorId);
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
        initialTeam={initialTeam}
        initialSearch={initialSearch}
        hasDbError={!!dbError}
        dbErrorMessage={dbError}
      />
    </div>
  );
}
