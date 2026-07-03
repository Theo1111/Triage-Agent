import { NextResponse } from "next/server";
import { fetchAllItems } from "@/app/dashboard/fetchDashboardData";

export const dynamic = "force-dynamic";

export async function GET() {
  console.log("[dashboard/data] fetch started");
  try {
    const items = await fetchAllItems();
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
