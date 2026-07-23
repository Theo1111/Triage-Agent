import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Set the shared Paperclip secret before the env proxy is first accessed.
process.env.PAPERCLIP_HEARTBEAT_SECRET = "test-paperclip-secret";

// Mock the boundaries so no real DB/pipeline/model is touched.
vi.mock("@/src/repositories/inboundEmailsRepository", () => ({
  findAwaitingClassification: vi.fn().mockResolvedValue([]),
  updateProcessingStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/src/services/autoTriagePipeline", () => ({
  runAutoTriagePipeline: vi.fn().mockResolvedValue({ skipped: false, triageItemId: "t1" }),
}));
vi.mock("@/src/services/paperclipAnalytics", () => ({
  getPaperclipAnalytics: vi.fn().mockResolvedValue({
    windowDays: 7,
    generatedAt: "2026-01-01T00:00:00.000Z",
    emails: { classified: 3, awaitingClassification: 0, classificationFailures: 0, classificationSuccessRate: 1 },
    triage: { activeTotal: 5, manualReview: 1, teamCounts: { engineering: 2, customer_success: 3 } },
    slack: { delivered: 4, failed: 0, deliverySuccessRate: 1 },
    quality: { corrections: 0, correctionRate: 0, falsePositives: 0, falseNegatives: 0, urgencyCorrections: 0, sensitivityCorrections: 0 },
  }),
}));

import { POST as heartbeatPOST } from "@/app/api/paperclip/heartbeat/route";
import { GET as analyticsGET } from "@/app/api/paperclip/analytics/route";
import * as inboundRepo from "@/src/repositories/inboundEmailsRepository";

const SECRET = "test-paperclip-secret";
function req(url: string, auth?: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new NextRequest(url, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("POST /api/paperclip/heartbeat contract", () => {
  beforeEach(() => vi.clearAllMocks());

  test("missing auth → 401", async () => {
    const res = await heartbeatPOST(req("http://x/api/paperclip/heartbeat", undefined, {}));
    expect(res.status).toBe(401);
  });

  test("invalid secret → 401", async () => {
    const res = await heartbeatPOST(req("http://x/api/paperclip/heartbeat", "Bearer wrong", {}));
    expect(res.status).toBe(401);
  });

  test("valid secret with empty backlog → 200 and safe payload", async () => {
    const res = await heartbeatPOST(req("http://x/api/paperclip/heartbeat", `Bearer ${SECRET}`, { runId: "pc-1", limit: 10 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.paperclipRunId).toBe("pc-1"); // runId propagation
    expect(json.found).toBe(0);
    expect(Array.isArray(json.results)).toBe(true);
    // Response must not leak email content.
    expect(JSON.stringify(json)).not.toMatch(/body_text|sender_email|raw_mime/);
  });

  test("processes backlog and returns per-item outcome", async () => {
    (inboundRepo.findAwaitingClassification as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "e1", subject: "x" },
    ]);
    const res = await heartbeatPOST(req("http://x/api/paperclip/heartbeat", `Bearer ${SECRET}`, {}));
    const json = await res.json();
    expect(json.found).toBe(1);
    expect(json.results[0]).toMatchObject({ inboundEmailId: "e1", outcome: "classified" });
  });

  test("invalid limit falls back to a safe default (no crash)", async () => {
    const res = await heartbeatPOST(req("http://x/api/paperclip/heartbeat", `Bearer ${SECRET}`, { limit: "abc" }));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/paperclip/analytics contract", () => {
  beforeEach(() => vi.clearAllMocks());

  test("missing/invalid secret → 401", async () => {
    expect((await analyticsGET(req("http://x/api/paperclip/analytics"))).status).toBe(401);
    expect((await analyticsGET(req("http://x/api/paperclip/analytics", "Bearer nope"))).status).toBe(401);
  });

  test("valid → 200 with safe aggregate payload only", async () => {
    const res = await analyticsGET(req("http://x/api/paperclip/analytics?days=7&runId=pc-9", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.paperclipRunId).toBe("pc-9");
    expect(json.analytics.triage.teamCounts).toHaveProperty("engineering");
    // No sensitive fields.
    expect(JSON.stringify(json)).not.toMatch(/body_text|sender_email|token|secret/i);
  });
});
