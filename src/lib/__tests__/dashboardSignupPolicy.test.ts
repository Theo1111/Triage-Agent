import { test } from "vitest";
import assert from "node:assert/strict";
import {
  isAllowedDashboardSignupEmail,
  normalizeSignupEmail,
} from "../dashboardSignupPolicy";

test("allows plain grata.life addresses", () => {
  assert.equal(isAllowedDashboardSignupEmail("theo@grata.life"), true);
  assert.equal(isAllowedDashboardSignupEmail("someone@grata.life"), true);
});

test("allows uppercase/whitespace variants via normalization", () => {
  assert.equal(isAllowedDashboardSignupEmail("  Theo@GRATA.LIFE  "), true);
});

test("rejects other domains", () => {
  assert.equal(isAllowedDashboardSignupEmail("someone@gmail.com"), false);
  assert.equal(isAllowedDashboardSignupEmail("someone@notgrata.life"), false);
});

test("rejects domain-suffix spoofing", () => {
  assert.equal(isAllowedDashboardSignupEmail("fake@grata.life.evil.com"), false);
  assert.equal(isAllowedDashboardSignupEmail("fake@evilgrata.life"), false);
  assert.equal(isAllowedDashboardSignupEmail("fake@sub.grata.life"), false);
});

test("rejects blank and non-email values", () => {
  assert.equal(isAllowedDashboardSignupEmail(""), false);
  assert.equal(isAllowedDashboardSignupEmail("   "), false);
  assert.equal(isAllowedDashboardSignupEmail("theo"), false);
  assert.equal(isAllowedDashboardSignupEmail("theo@"), false);
  assert.equal(isAllowedDashboardSignupEmail("@grata.life"), false);
  assert.equal(isAllowedDashboardSignupEmail("theo grata.life"), false);
  assert.equal(isAllowedDashboardSignupEmail("a@b@grata.life"), false);
});

test("normalizeSignupEmail trims and lowercases", () => {
  assert.equal(normalizeSignupEmail("  Theo@Grata.Life "), "theo@grata.life");
});
