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

// Team keys mirror the dashboard tabs, which route by
// email_classifications.recommended_owner (see app/dashboard/utils.ts).
const TEAM_BUCKETS = [
  { key: "operations", label: "Operations" },
  { key: "engineering", label: "Engineering" },
  { key: "customer_success", label: "Customer Success" },
  { key: "field_ops", label: "Field Ops" },
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
  const rangeClause = range ? " AND ti.created_at >= $1 AND ti.created_at < $2" : "";
  const params: unknown[] = range ? [range.from, range.to] : [];
  const rows = await query<TeamCountRow>(
    `SELECT COALESCE(ec.recommended_owner, 'other') AS team, count(*)::int AS count
     FROM triage_items ti
     LEFT JOIN email_classifications ec ON ec.id = ti.classification_id
     WHERE ti.status NOT IN ('resolved', 'archived', 'ignored')${rangeClause}
     GROUP BY 1`,
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
  const runRangeClause = range ? " AND cr.started_at >= $1 AND cr.started_at < $2" : "";

  try {
    const [emailsProcessed, emailsFlagged, falsePositives, teams] =
      await Promise.all([
        query<CountRow>(
          `SELECT count(DISTINCT cr.inbound_email_id)::int AS count FROM classification_runs cr
           WHERE cr.status = 'success'${runRangeClause}`,
          rangeParams,
        ).catch(() => [{ count: 0 }]),
        query<CountRow>(
          `SELECT count(DISTINCT inbound_email_id)::int AS count FROM triage_items
           WHERE true${rangeClause}`,
          rangeParams,
        ).catch(() => [{ count: 0 }]),
        // A flagged email whose triage item was dismissed as 'ignored' is a
        // false positive: the agent raised it, a human decided it wasn't real.
        query<CountRow>(
          `SELECT count(DISTINCT inbound_email_id)::int AS count FROM triage_items
           WHERE status = 'ignored'${rangeClause}`,
          rangeParams,
        ).catch(() => [{ count: 0 }]),
        fetchTeamCounts(range),
      ]);

    const n = (rows: CountRow[]) => Number(rows[0]?.count ?? 0);
    const flagged = n(emailsFlagged);
    const falsePositiveRate = flagged > 0 ? Math.round((n(falsePositives) / flagged) * 1000) / 10 : 0;

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      metrics: [
        // Agent-quality metrics only: open/urgent volumes live in the `teams`
        // breakdown and are already visualized in Paperclip's live flow, so
        // repeating them in the Company signal rail would double count.
        { key: "emails_processed", label: "Emails processed", value: n(emailsProcessed), severity: "high" },
        { key: "emails_flagged", label: "Emails flagged", value: flagged, severity: "high" },
        { key: "false_positive_rate", label: "False positive rate (%)", value: falsePositiveRate, severity: "high" },
      ],
      topItems: [],
      teams,
    });
  } catch (error) {
    console.error("[paperclip/analytics] failed", error);
    return NextResponse.json({ error: "Unable to compute triage analytics." }, { status: 500 });
  }
}
