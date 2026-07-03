import { NextRequest, NextResponse } from "next/server";
import { fetchAllItemsForOperator } from "@/app/dashboard/fetchDashboardData";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  console.log("[dashboard/data] fetch started");
  try {
    const operator = await getOperatorFromRequest(req);
    const items = await fetchAllItemsForOperator(operator?.id ?? null);
    console.log(`[dashboard/data] fetch completed items=${items.length}`);
    return NextResponse.json({
      ok: true,
      items,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[dashboard/data] fetch failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
