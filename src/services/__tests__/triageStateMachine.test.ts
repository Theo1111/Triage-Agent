import { describe, test, expect } from "vitest";
import { allowedActions, canApply, REMOVES_FROM_ACTIVE } from "@/src/services/triageStateMachine";
import type { TriageDisplayInput } from "@/src/lib/triageDisplayState";

const item = (over: Partial<TriageDisplayInput>): TriageDisplayInput => ({
  status: "new",
  owner: null,
  assigned_at: null,
  escalated_at: null,
  ...over,
});

describe("shared state-transition contract", () => {
  test("new active case allows assign/escalate/resolve/archive", () => {
    expect(allowedActions(item({ status: "new" })).sort()).toEqual(["archive", "assign", "escalate", "resolve"]);
  });

  test("assigned case offers unassign (not assign)", () => {
    const a = allowedActions(item({ status: "assigned", owner: "op", assigned_at: "2026-01-01" }));
    expect(a).toContain("unassign");
    expect(a).not.toContain("assign");
  });

  test("escalated case offers unescalate", () => {
    const a = allowedActions(item({ status: "escalated", escalated_at: "2026-01-01" }));
    expect(a).toContain("unescalate");
  });

  test("resolved case allows reopen + archive, not resolve", () => {
    const a = allowedActions(item({ status: "resolved" }));
    expect(a).toContain("reopen");
    expect(a).not.toContain("resolve");
  });

  test("archived case only allows restore", () => {
    expect(allowedActions(item({ status: "archived" }))).toEqual(["restore"]);
  });

  test("canApply rejects illegal transitions with a reason", () => {
    const resolved = item({ status: "resolved" });
    expect(canApply("escalate", resolved).ok).toBe(false);
    expect(canApply("reopen", resolved).ok).toBe(true);
  });

  test("resolve + archive are flagged as removing a case from the active queue", () => {
    expect(REMOVES_FROM_ACTIVE.has("resolve")).toBe(true);
    expect(REMOVES_FROM_ACTIVE.has("archive")).toBe(true);
    expect(REMOVES_FROM_ACTIVE.has("assign")).toBe(false);
  });
});
