import { describe, test, expect } from "vitest";
import {
  deriveSlackEligible,
  scoreFixture,
  scoreFixtureOffline,
  computeMetrics,
  checkThresholds,
  toArray,
} from "@/src/evaluation/scoring";
import type { EvalFixture, EvalActual } from "@/src/evaluation/types";
import { allFixtures, validateFixture, findDuplicateIds } from "@/tests/evaluation/fixtures";

const baseFixture: EvalFixture = {
  id: "t1",
  suite: "unit",
  subject: "s",
  body: "b",
  senderType: "resident",
  inbox: "in",
  expected: {
    relevance: "actionable",
    urgency: "urgent",
    sensitivity: "public_internal",
    primaryCategory: "app_or_software",
    recommendedOwner: "customer_success",
    routeType: "slack_channel",
    slackEligible: true,
    manualReviewRequired: false,
  },
  explanation: "x",
};

const perfectActual: EvalActual = {
  relevance: "actionable",
  urgency: "urgent",
  sensitivity: "public_internal",
  primaryCategory: "app_or_software",
  recommendedOwner: "customer_success",
  routeType: "slack_channel",
  slackEligible: true,
  manualReviewRequired: false,
};

describe("deriveSlackEligible", () => {
  test("eligible only when urgent + public_internal + shared + slack_channel", () => {
    expect(deriveSlackEligible({ urgency_level: "urgent", sensitivity_level: "public_internal", shared_slack_allowed: true, route_type: "slack_channel" })).toBe(true);
    expect(deriveSlackEligible({ urgency_level: "normal", sensitivity_level: "public_internal", shared_slack_allowed: true, route_type: "slack_channel" })).toBe(false);
    expect(deriveSlackEligible({ urgency_level: "urgent", sensitivity_level: "sensitive", shared_slack_allowed: true, route_type: "slack_channel" })).toBe(false);
    expect(deriveSlackEligible({ urgency_level: "urgent", sensitivity_level: "public_internal", shared_slack_allowed: false, route_type: "slack_channel" })).toBe(false);
  });
});

describe("scoreFixture", () => {
  test("perfect actual passes all fields", () => {
    const r = scoreFixture(baseFixture, perfectActual);
    expect(r.passed).toBe(true);
    expect(r.safetyPassed).toBe(true);
  });

  test("acceptable-label set matches any member", () => {
    const fx: EvalFixture = { ...baseFixture, expected: { ...baseFixture.expected, recommendedOwner: ["customer_success", "operations"] } };
    const r = scoreFixture({ ...fx }, { ...perfectActual, recommendedOwner: "operations" });
    expect(r.passed).toBe(true);
  });

  test("safety-critical miss flips safetyPassed", () => {
    const fx: EvalFixture = { ...baseFixture, safetyCritical: ["sensitivity"] };
    const r = scoreFixture(fx, { ...perfectActual, sensitivity: "sensitive" });
    expect(r.passed).toBe(false);
    expect(r.safetyPassed).toBe(false);
  });
});

describe("computeMetrics", () => {
  test("all-correct yields 100% and thresholds pass", () => {
    const results = [scoreFixture(baseFixture, perfectActual)];
    const m = computeMetrics([baseFixture], results);
    expect(m.overallAccuracy).toBe(1);
    expect(m.safetyCriticalRecall).toBe(1);
    expect(checkThresholds(m).passed).toBe(true);
  });

  test("a missed sensitive case fails the sensitivity-recall threshold", () => {
    const sensitiveFx: EvalFixture = {
      ...baseFixture,
      id: "sens",
      expected: { ...baseFixture.expected, urgency: "normal", sensitivity: "sensitive", routeType: "manual_review", slackEligible: false, manualReviewRequired: true },
      safetyCritical: ["sensitivity"],
    };
    // Model wrongly says public_internal → false negative on sensitivity.
    const actual: EvalActual = { ...perfectActual, urgency: "normal", sensitivity: "public_internal", routeType: "manual_review", slackEligible: false, manualReviewRequired: true };
    const results = [scoreFixture(sensitiveFx, actual)];
    const m = computeMetrics([sensitiveFx], results);
    expect(m.sensitivitySensitive.recall).toBeLessThan(1);
    expect(m.safetyCriticalRecall).toBeLessThan(1);
    expect(checkThresholds(m).passed).toBe(false);
  });
});

describe("corpus integrity", () => {
  test("no duplicate fixture ids", () => {
    expect(findDuplicateIds(allFixtures)).toEqual([]);
  });
  test("every fixture uses valid vocabulary", () => {
    const problems = allFixtures.flatMap(validateFixture);
    expect(problems).toEqual([]);
  });
  test("every fixture is self-consistent with the deterministic routing guards", () => {
    const failures = allFixtures
      .map(scoreFixtureOffline)
      .filter(r => !r.passed)
      .map(r => `${r.fixtureId}: ${r.fields.filter(f => !f.correct).map(f => f.field).join(",")}`);
    expect(failures).toEqual([]);
  });
  test("corpus covers all five suites", () => {
    const suites = new Set(allFixtures.map(f => f.suite));
    expect([...suites].sort()).toEqual(["regression", "routing", "safety", "thread-lifecycle", "unit"]);
  });
  test("toArray normalizes single and set expectations", () => {
    expect(toArray("a")).toEqual(["a"]);
    expect(toArray(["a", "b"])).toEqual(["a", "b"]);
  });
});
