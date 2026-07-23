import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/services/triageItems", () => ({
  assignTriageItem: vi.fn(),
  escalateTriageItem: vi.fn(),
  resolveTriageItem: vi.fn(),
  archiveTriageItem: vi.fn(),
}));
vi.mock("@/src/services/agentAuditLog", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/src/lib/slack/syncTriageToSlack", () => ({ syncTriageItemToSlack: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/src/lib/assignmentOwner", () => ({
  resolveAssignmentOwner: vi.fn().mockResolvedValue({ owner: "op@grata.life", label: "Op" }),
}));

import { runBulkAction } from "@/src/services/bulkTriage";
import * as triage from "@/src/services/triageItems";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";

const operator = { id: "op-1", username: "op@grata.life", displayName: "Op" };
const resolveMock = triage.resolveTriageItem as ReturnType<typeof vi.fn>;
const archiveMock = triage.archiveTriageItem as ReturnType<typeof vi.fn>;
const syncMock = syncTriageItemToSlack as ReturnType<typeof vi.fn>;

describe("runBulkAction — failure behavior", () => {
  beforeEach(() => {
    resolveMock.mockReset();
    archiveMock.mockReset();
    syncMock.mockReset().mockResolvedValue(undefined);
  });

  test("empty selection is rejected", async () => {
    await expect(runBulkAction({ action: "resolve", triageItemIds: [], operator })).rejects.toThrow(/no_items/);
  });

  test("exceeding the max bulk size is rejected", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    await expect(runBulkAction({ action: "resolve", triageItemIds: ids, operator })).rejects.toThrow(/too_many/);
  });

  test("mixed valid + invalid returns per-case results (partial failure, no abort)", async () => {
    resolveMock.mockImplementation((id: string) => {
      if (id === "bad") return Promise.reject(new Error("already resolved"));
      return Promise.resolve({ id, inbound_email_id: `e-${id}`, status: "resolved" });
    });
    const res = await runBulkAction({ action: "resolve", triageItemIds: ["a", "bad", "c"], operator });
    expect(res.successCount).toBe(2);
    expect(res.failureCount).toBe(1);
    expect(res.results.find(r => r.triageItemId === "bad")).toMatchObject({ ok: false });
    expect(res.results.find(r => r.triageItemId === "bad")?.error).toMatch(/already resolved/);
    // The good ones still succeeded — a single failure did not abort the batch.
    expect(res.results.filter(r => r.ok).map(r => r.triageItemId).sort()).toEqual(["a", "c"]);
  });

  test("duplicate ids are de-duplicated", async () => {
    resolveMock.mockResolvedValue({ id: "x", inbound_email_id: "e", status: "resolved" });
    const res = await runBulkAction({ action: "resolve", triageItemIds: ["x", "x", "x"], operator });
    expect(res.results).toHaveLength(1);
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });

  test("a Slack sync failure does not fail the case", async () => {
    resolveMock.mockResolvedValue({ id: "x", inbound_email_id: "e", status: "resolved" });
    syncMock.mockRejectedValue(new Error("slack down"));
    const res = await runBulkAction({ action: "resolve", triageItemIds: ["x"], operator });
    expect(res.successCount).toBe(1); // DB change stands despite Slack failure
  });

  test("archive routes through the archive transition with the operator recorded", async () => {
    archiveMock.mockResolvedValue({ id: "x", inbound_email_id: "e", status: "archived" });
    const res = await runBulkAction({ action: "archive", triageItemIds: ["x"], operator });
    expect(res.successCount).toBe(1);
    expect(archiveMock).toHaveBeenCalledWith("x", operator.username, null);
  });
});
