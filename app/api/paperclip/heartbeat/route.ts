import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import { runAutoTriagePipeline } from "@/src/services/autoTriagePipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type HeartbeatBody = {
  runId?: unknown;
  limit?: unknown;
};

function authenticated(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const tokenHash = createHash("sha256").update(token).digest();
  const secretHash = createHash("sha256").update(secret).digest();
  return timingSafeEqual(tokenHash, secretHash);
}

async function parseBody(req: NextRequest): Promise<HeartbeatBody> {
  try {
    const body: unknown = await req.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as HeartbeatBody)
      : {};
  } catch {
    return {};
  }
}

function parseLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 25;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

export async function POST(req: NextRequest) {
  const secret = env.PAPERCLIP_HEARTBEAT_SECRET;
  if (!secret || !authenticated(req, secret)) {
    console.warn("[paperclip/heartbeat] Unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await parseBody(req);
  const paperclipRunId =
    typeof body.runId === "string" && body.runId.length > 0 ? body.runId : null;
  const limit = parseLimit(body.limit);

  try {
    const pending = await inboundEmailsRepo.findAwaitingClassification(limit);
    console.log(`[paperclip/heartbeat] found=${pending.length} limit=${limit}`);

    const results: Array<{
      inboundEmailId: string;
      outcome: "classified" | "pipeline_error" | "skipped" | "threw";
      triageItemId?: string | null;
    }> = [];
    let processed = 0;
    let failed = 0;

    // Sequential on purpose: keeps DB/OpenAI/Slack load flat and preserves
    // the repository's oldest-first ordering.
    for (const email of pending) {
      try {
        const result = await runAutoTriagePipeline(email.id);
        processed++;

        if (result.error) {
          failed++;
          results.push({
            inboundEmailId: email.id,
            outcome: "pipeline_error",
            triageItemId: result.triageItemId,
          });
        } else if (result.skipped) {
          results.push({
            inboundEmailId: email.id,
            outcome: "skipped",
            triageItemId: result.triageItemId,
          });

          // Match the cron sweeper: suppressed/linked replies must not remain
          // awaiting classification and get retried on every heartbeat.
          await inboundEmailsRepo
            .updateProcessingStatus(email.id, "classification_ready")
            .catch(err =>
              console.warn(
                `[paperclip/heartbeat] status update failed email=${email.id}:`,
                err
              )
            );
        } else {
          results.push({
            inboundEmailId: email.id,
            outcome: "classified",
            triageItemId: result.triageItemId,
          });
        }
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[paperclip/heartbeat] pipeline failed email=${email.id}:`,
          message
        );
        results.push({ inboundEmailId: email.id, outcome: "threw" });
      }
    }

    console.log(
      `[paperclip/heartbeat] done found=${pending.length} processed=${processed} failed=${failed}`
    );

    return NextResponse.json({
      ok: true,
      paperclipRunId,
      found: pending.length,
      processed,
      failed,
      results,
    });
  } catch (err) {
    console.error("[paperclip/heartbeat] Unhandled invocation failure:", err);
    return NextResponse.json(
      { ok: false, error: "Heartbeat invocation failed" },
      { status: 500 }
    );
  }
}
