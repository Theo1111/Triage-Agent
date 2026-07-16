import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { query } from "@/src/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authenticated(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;
  const tokenHash = createHash("sha256").update(token).digest();
  const secretHash = createHash("sha256").update(secret).digest();
  return timingSafeEqual(tokenHash, secretHash);
}

type CountRow = { count: string | number };
type TeamCountRow = { team: string; count: string | number };

// Mirrors TEAM_CATEGORIES in src/config/roles.ts — keep in sync.
const TEAM_BUCKETS = [
  {
    key: "operations",
    label: "Operations",
    categories: [
      "access_or_lockout",
      "building_infrastructure",
      "hardware_or_device",
      "cameras_or_security_video",
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    categories: ["app_or_software", "engineering_blocker", "access_control", "ict_or_intercom"],
  },
  { key: "customer_success", label: "Customer Success", categories: ["customer_escalation"] },
  { key: "field_ops", label: "Field Ops", categories: ["field_ops"] },
] as const;

type DateRange = { from: string; to: string };

/**
 * Optional created_at window from range/from/to query params. Invalid or
 * missing bounds mean all-time, matching the previous behavior.
 */
function parseDateRange(url: URL): DateRange | null {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return null;
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
    return null;
  }
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

async function fetchTeamCounts(
  range: DateRange | null,
): Promise<Array<{ key: string; label: string; count: number; severity: string }>> {
  const cases = TEAM_BUCKETS.map(
    (team, index) =>
      `WHEN ec.primary_category = ANY($${index + 1}::text[]) THEN '${team.key}'`,
  ).join(" ");
  const rangeClause = range
    ? ` AND ti.created_at >= $${TEAM_BUCKETS.length + 1} AND ti.created_at < $${TEAM_BUCKETS.length + 2}`
    : "";
  const params: unknown[] = TEAM_BUCKETS.map((team) => [...team.categories]);
  if (range) params.push(range.from, range.to);
  const rows = await query<TeamCountRow>(
    `SELECT team, count(*)::int AS count FROM (
       SELECT CASE ${cases} ELSE 'other' END AS team
       FROM triage_items ti
       LEFT JOIN email_classifications ec ON ec.id = ti.classification_id
       WHERE ti.status NOT IN ('resolved', 'archived', 'ignored')${rangeClause}
     ) teamed
     GROUP BY team`,
    params,
  ).catch(() => [] as TeamCountRow[]);
  const counts = new Map(rows.map((row) => [row.team, Number(row.count ?? 0)]));
  return TEAM_BUCKETS.map((team) => ({
    key: team.key,
    label: team.label,
    count: counts.get(team.key) ?? 0,
    severity:
      team.key === "customer_success" ? "high" : team.key === "engineering" ? "medium" : "info",
  }));
}

export async function GET(req: NextRequest) {
  const secret = env.PAPERCLIP_HEARTBEAT_SECRET;
  if (!secret || !authenticated(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = parseDateRange(new URL(req.url));
  const rangeClause = range ? " AND created_at >= $1 AND created_at < $2" : "";
  const rangeParams = range ? [range.from, range.to] : [];

  try {
    const [open, urgentOpen, manualReview, escalated, failedRuns, lowConfidence, teams] = await Promise.all([
      query<CountRow>(
        `SELECT count(*)::int AS count FROM triage_items
         WHERE status NOT IN ('resolved', 'archived', 'ignored')${rangeClause}`,
        rangeParams,
      ),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM triage_items
         WHERE status NOT IN ('resolved', 'archived', 'ignored')
           AND urgency_level = 'urgent'${rangeClause}`,
        rangeParams,
      ),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM triage_items WHERE status = 'manual_review'${rangeClause}`,
        rangeParams,
      ),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM triage_items
         WHERE (status = 'escalated' OR escalated_at IS NOT NULL)${rangeClause}`,
        rangeParams,
      ),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM classification_runs
         WHERE status = 'failed'
           AND created_at > now() - interval '7 days'`,
      ).catch(() => [{ count: 0 }]),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM classification_runs
         WHERE confidence_score IS NOT NULL
           AND confidence_score < 0.7
           AND created_at > now() - interval '7 days'`,
      ).catch(() => [{ count: 0 }]),
      fetchTeamCounts(range),
    ]);

    const n = (rows: CountRow[]) => Number(rows[0]?.count ?? 0);

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      metrics: [
        { key: "open", label: "Open items", value: n(open), severity: "info" },
        { key: "urgent_open", label: "Urgent open", value: n(urgentOpen), severity: "critical" },
        { key: "manual_review", label: "Manual review", value: n(manualReview), severity: "high" },
        { key: "escalated", label: "Escalated", value: n(escalated), severity: "high" },
        { key: "failed_runs", label: "Failed runs (7d)", value: n(failedRuns), severity: "high" },
        { key: "low_confidence", label: "Low confidence (7d)", value: n(lowConfidence), severity: "medium" },
      ],
      topItems: [],
      teams,
    });
  } catch (error) {
    console.error("[paperclip/analytics] failed", error);
    return NextResponse.json({ error: "Unable to compute triage analytics." }, { status: 500 });
  }
}
