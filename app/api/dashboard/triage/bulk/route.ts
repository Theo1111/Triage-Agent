import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import { runBulkAction, type BulkAction } from "@/src/services/bulkTriage";

export const dynamic = "force-dynamic";

const VALID_ACTIONS: BulkAction[] = ["assign_self", "assign", "escalate", "resolve", "archive"];

export async function POST(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      return NextResponse.json(
        { success: false, error: "Authentication required. Please log in." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as {
      action?: BulkAction;
      triageItemIds?: string[];
      owner?: { kind: "operator" | "team"; value: string };
    };

    if (!body.action || !VALID_ACTIONS.includes(body.action)) {
      return NextResponse.json(
        { success: false, error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.triageItemIds) || body.triageItemIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "triageItemIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const result = await runBulkAction({
      action: body.action,
      triageItemIds: body.triageItemIds,
      owner: body.owner,
      operator,
    });

    // 200 even on partial failure — the per-item results carry the detail so the
    // UI can show an accurate summary and never sit in an uncertain state.
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
