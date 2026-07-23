import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock the schema self-heal (no DB) and the triage repository so we can simulate
// the concurrent-create race deterministically.
vi.mock("@/src/lib/ensureTriageSchema", () => ({
  ensureTriageSchema: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/src/repositories/triageItemsRepository", () => ({
  insert: vi.fn(),
  findActiveByThreadId: vi.fn(),
}));

import * as repo from "@/src/repositories/triageItemsRepository";
import { createTriageItemFromContext, isUniqueViolation } from "@/src/services/triageItems";

const insert = repo.insert as unknown as ReturnType<typeof vi.fn>;
const findActiveByThreadId = repo.findActiveByThreadId as unknown as ReturnType<typeof vi.fn>;

function makeCtx(threadId: string | null) {
  return {
    email: {
      id: "email-1",
      source_inbox_email: "support@example",
      sender_email: "r@example.test",
      sender_name: "Resident",
      subject: "Locked out",
      gmail_thread_id: threadId,
    },
    classification: {
      id: "cls-1",
      summary: "Resident locked out",
      urgency_level: "urgent",
      sensitivity_level: "public_internal",
      recommended_owner: "operations",
      recommended_next_step: "help",
    },
    routingRecommendation: { id: "rr-1", route_type: "slack_channel" },
  } as never;
}

function uniqueViolation() {
  const e = new Error("duplicate key value violates unique constraint") as Error & { code: string };
  e.code = "23505";
  return e;
}

describe("one canonical case per thread — concurrency", () => {
  beforeEach(() => {
    insert.mockReset();
    findActiveByThreadId.mockReset();
  });

  test("normal create returns the inserted item", async () => {
    const inserted = { id: "case-1", status: "new", urgency_level: "urgent", sensitivity_level: "public_internal" };
    insert.mockResolvedValueOnce(inserted);
    const result = await createTriageItemFromContext(makeCtx("thread-A"), { slackAction: "posted" });
    expect(result).toBe(inserted);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  test("losing the unique-index race links to the winning case (no duplicate)", async () => {
    const winner = { id: "case-winner", status: "new" };
    insert.mockRejectedValueOnce(uniqueViolation());
    findActiveByThreadId.mockResolvedValueOnce(winner);

    const result = await createTriageItemFromContext(makeCtx("thread-A"), { slackAction: "posted" });
    expect(result).toBe(winner);
    expect(findActiveByThreadId).toHaveBeenCalledWith("thread-A");
  });

  test("unique violation with no existing active case rethrows", async () => {
    insert.mockRejectedValueOnce(uniqueViolation());
    findActiveByThreadId.mockResolvedValueOnce(null);
    await expect(createTriageItemFromContext(makeCtx("thread-A"), { slackAction: "posted" })).rejects.toThrow();
  });

  test("missing thread id falls back to per-email identity (no thread lookup)", async () => {
    const inserted = { id: "case-2", status: "new" };
    insert.mockResolvedValueOnce(inserted);
    const result = await createTriageItemFromContext(makeCtx(null), { slackAction: "posted" });
    expect(result).toBe(inserted);
    expect(findActiveByThreadId).not.toHaveBeenCalled();
  });

  test("isUniqueViolation detects SQLSTATE 23505 only", () => {
    expect(isUniqueViolation(uniqueViolation())).toBe(true);
    expect(isUniqueViolation(new Error("other"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
