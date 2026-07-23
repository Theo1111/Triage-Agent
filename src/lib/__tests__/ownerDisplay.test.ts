// Tests for owner resolution + SLA logic.
// Run with: npx tsx --test src/lib/__tests__/ownerDisplay.test.ts

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveOwner, findOperatorForOwner } from "../ownerDisplay";
import { isSlaBreached, slaDeadlineMs } from "@/src/config/sla";

const OPS = [
  { id: "u1", username: "tblumberg@grata.life", displayName: "Theodore Blumberg" },
  { id: "u2", username: "jane@grata.life", displayName: "Jane Doe" },
];

describe("resolveOwner", () => {
  test("unassigned when empty", () => {
    assert.equal(resolveOwner(null, OPS).kind, "unassigned");
    assert.equal(resolveOwner("", OPS).kind, "unassigned");
  });

  test("resolves a canonical id to the operator display name", () => {
    // "tblumberg" canonicalizes to the same identity as the email username.
    const r = resolveOwner("tblumberg", OPS);
    assert.equal(r.kind, "operator");
    assert.equal(r.label, "Theodore Blumberg");
  });

  test("resolves an email username directly", () => {
    const r = resolveOwner("jane@grata.life", OPS);
    assert.equal(r.kind, "operator");
    assert.equal(r.label, "Jane Doe");
  });

  test("recognises a team label", () => {
    const r = resolveOwner("engineering", OPS);
    assert.equal(r.kind, "team");
    assert.equal(r.label, "Engineering");
  });

  test("falls back to raw text for unknown owner", () => {
    const r = resolveOwner("someone_else", OPS);
    assert.equal(r.kind, "other");
    assert.equal(r.label, "someone_else");
  });

  test("findOperatorForOwner matches by canonical identity", () => {
    assert.equal(findOperatorForOwner("tblumberg", OPS)?.id, "u1");
    assert.equal(findOperatorForOwner("nope", OPS), undefined);
  });
});

describe("SLA", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

  test("urgent breaches after 4h", () => {
    assert.equal(
      isSlaBreached({ status: "new", urgency_level: "urgent", created_at: hoursAgo(5) }),
      true
    );
    assert.equal(
      isSlaBreached({ status: "new", urgency_level: "urgent", created_at: hoursAgo(1) }),
      false
    );
  });

  test("normal breaches after 24h", () => {
    assert.equal(
      isSlaBreached({ status: "assigned", urgency_level: "normal", created_at: hoursAgo(25) }),
      true
    );
    assert.equal(
      isSlaBreached({ status: "assigned", urgency_level: "normal", created_at: hoursAgo(10) }),
      false
    );
  });

  test("closed cases never breach", () => {
    assert.equal(
      isSlaBreached({ status: "resolved", urgency_level: "urgent", created_at: hoursAgo(100) }),
      false
    );
  });

  test("not_relevant has no deadline", () => {
    assert.equal(
      slaDeadlineMs({ status: "new", urgency_level: "not_relevant", created_at: hoursAgo(100) }),
      null
    );
  });
});
