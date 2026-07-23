import { applyRoutingOverrides, type EmailTriageOutput } from "@/src/agents/emailTriageAgent";
import type {
  EvalActual,
  EvalExpected,
  EvalFixture,
  Expect,
  FieldScore,
  SafetyField,
  ScoredResult,
} from "./types";

// ── Matching ────────────────────────────────────────────────────────────────

export function toArray<T>(e: Expect<T>): T[] {
  return Array.isArray(e) ? e : [e];
}

function matches<T>(actual: T, expected: Expect<T>): boolean {
  return toArray(expected).includes(actual);
}

// ── Projection: EmailTriageOutput → evaluation field space ───────────────────
// Slack eligibility mirrors slackAlerts.isSharedSlackEligible: an alert is only
// eligible when urgent + public_internal + shared_slack_allowed + slack_channel.
export function deriveSlackEligible(o: {
  urgency_level: string;
  sensitivity_level: string;
  shared_slack_allowed: boolean;
  route_type: string;
}): boolean {
  return (
    o.urgency_level === "urgent" &&
    o.sensitivity_level === "public_internal" &&
    o.shared_slack_allowed === true &&
    o.route_type === "slack_channel"
  );
}

export function projectOutput(o: EmailTriageOutput): EvalActual {
  return {
    relevance: o.urgency_level === "not_relevant" ? "irrelevant" : "actionable",
    urgency: o.urgency_level,
    sensitivity: o.sensitivity_level,
    primaryCategory: o.primary_category,
    recommendedOwner: o.recommended_owner,
    routeType: o.route_type,
    slackEligible: deriveSlackEligible(o),
    manualReviewRequired: o.needs_manual_review || o.route_type === "manual_review",
  };
}

// ── Scoring one fixture against a concrete actual ────────────────────────────

const FIELD_KEYS: SafetyField[] = [
  "relevance",
  "urgency",
  "sensitivity",
  "primaryCategory",
  "recommendedOwner",
  "routeType",
  "slackEligible",
  "manualReviewRequired",
];

export function scoreFixture(fixture: EvalFixture, actual: EvalActual): ScoredResult {
  const safety = new Set(fixture.safetyCritical ?? []);
  const exp = fixture.expected;

  const fields: FieldScore[] = FIELD_KEYS.map(field => {
    const expectedVal = exp[field];
    const actualVal = actual[field];
    const correct = matches(actualVal as never, expectedVal as never);
    return {
      field,
      expected: JSON.stringify(expectedVal),
      actual: String(actualVal),
      correct,
      safetyCritical: safety.has(field),
    };
  });

  const passed = fields.every(f => f.correct);
  const safetyPassed = fields.filter(f => f.safetyCritical).every(f => f.correct);
  return { fixtureId: fixture.id, suite: fixture.suite, passed, safetyPassed, fields, actual };
}

// ── Offline: synthesize an ideal output from expected, run the real
//    deterministic guards, and confirm the corpus is self-consistent. ─────────
function firstOf<T>(e: Expect<T>): T {
  return toArray(e)[0];
}

export function synthOutputFromExpected(exp: EvalExpected): EmailTriageOutput {
  const urgency = firstOf(exp.urgency);
  const sensitivity = firstOf(exp.sensitivity);
  const route = firstOf(exp.routeType);
  return {
    urgency_level: urgency,
    sensitivity_level: sensitivity,
    primary_category: firstOf(exp.primaryCategory),
    category_tags: [],
    summary: "synthetic",
    urgency_reason: "synthetic",
    sensitivity_reason: "synthetic",
    recommended_owner: firstOf(exp.recommendedOwner),
    recommended_next_step: "synthetic",
    // High confidence so the <0.7 override does not fire unless intended.
    confidence_score: 0.9,
    shared_slack_allowed: exp.slackEligible,
    private_route_required: sensitivity !== "public_internal",
    route_type: route,
    operational_impact_detected: urgency === "urgent",
    affected_parties: [],
    blocked_workflow: null,
    human_language_signals: [],
    matched_vocabulary_terms: [],
    impact_reasoning: "synthetic",
    safe_slack_summary: "synthetic",
    needs_manual_review: exp.manualReviewRequired,
  };
}

// Runs the fixture's ideal output through applyRoutingOverrides and scores the
// result against the fixture. A failure means the authored expectations
// contradict the deterministic routing/sensitivity guards (a corpus bug).
export function scoreFixtureOffline(fixture: EvalFixture): ScoredResult {
  const synth = synthOutputFromExpected(fixture.expected);
  const { result } = applyRoutingOverrides(synth);
  return scoreFixture(fixture, projectOutput(result));
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export interface BinaryStats {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface EvalMetrics {
  total: number;
  overallAccuracy: number; // fixtures with all fields correct
  actionable: BinaryStats; // positive class = "actionable"
  urgencyUrgent: BinaryStats; // positive class = urgency "urgent"
  sensitivitySensitive: BinaryStats; // positive class = sensitivity private|sensitive
  safetyCriticalRecall: number; // fraction of safety-critical fields correct
  categoryAccuracy: number;
  ownerAccuracy: number;
  routeAccuracy: number;
  slackEligibilityAccuracy: number;
  manualReviewAccuracy: number;
  falsePositiveRate: number; // irrelevant scored as actionable
  falseNegativeRate: number; // actionable scored as irrelevant
  byCategory: Record<string, { total: number; correct: number; accuracy: number }>;
  bySuite: Record<string, { total: number; passed: number; accuracy: number }>;
  failedFixtureIds: string[];
  safetyFailedFixtureIds: string[];
}

function binary(
  cases: Array<{ expectedPos: boolean; actualPos: boolean }>
): BinaryStats {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of cases) {
    if (c.expectedPos && c.actualPos) tp++;
    else if (!c.expectedPos && c.actualPos) fp++;
    else if (c.expectedPos && !c.actualPos) fn++;
    else tn++;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn, tn };
}

function fieldCorrect(r: ScoredResult, field: SafetyField): boolean {
  return r.fields.find(f => f.field === field)?.correct ?? false;
}

// Was the given field's *expected* one of the "positive" labels?
function expectedHas(fixture: EvalFixture, field: keyof EvalExpected, labels: string[]): boolean {
  return toArray(fixture.expected[field] as Expect<string>).some(v => labels.includes(v));
}

export function computeMetrics(
  fixtures: EvalFixture[],
  results: ScoredResult[]
): EvalMetrics {
  const byId = new Map(fixtures.map(f => [f.id, f]));
  const total = results.length;

  const actionableCases = results.map(r => {
    const fx = byId.get(r.fixtureId)!;
    return {
      expectedPos: expectedHas(fx, "relevance", ["actionable"]),
      actualPos: r.actual.relevance === "actionable",
    };
  });
  const urgentCases = results.map(r => {
    const fx = byId.get(r.fixtureId)!;
    return {
      expectedPos: expectedHas(fx, "urgency", ["urgent"]),
      actualPos: r.actual.urgency === "urgent",
    };
  });
  const sensitiveCases = results.map(r => {
    const fx = byId.get(r.fixtureId)!;
    return {
      expectedPos: expectedHas(fx, "sensitivity", ["private", "sensitive"]),
      actualPos: r.actual.sensitivity === "private" || r.actual.sensitivity === "sensitive",
    };
  });

  const actionable = binary(actionableCases);
  const acc = (field: SafetyField) => results.filter(r => fieldCorrect(r, field)).length / (total || 1);

  // Safety-critical recall: across every fixture's declared safety-critical
  // fields, fraction scored correct (1.0 required — a safety miss is worst-case).
  let safetyTotal = 0, safetyCorrect = 0;
  for (const r of results) {
    for (const f of r.fields) {
      if (f.safetyCritical) {
        safetyTotal++;
        if (f.correct) safetyCorrect++;
      }
    }
  }

  const byCategory: EvalMetrics["byCategory"] = {};
  for (const r of results) {
    const fx = byId.get(r.fixtureId)!;
    const cat = toArray(fx.expected.primaryCategory)[0];
    byCategory[cat] ??= { total: 0, correct: 0, accuracy: 0 };
    byCategory[cat].total++;
    if (fieldCorrect(r, "primaryCategory")) byCategory[cat].correct++;
  }
  for (const c of Object.values(byCategory)) c.accuracy = c.correct / (c.total || 1);

  const bySuite: EvalMetrics["bySuite"] = {};
  for (const r of results) {
    bySuite[r.suite] ??= { total: 0, passed: 0, accuracy: 0 };
    bySuite[r.suite].total++;
    if (r.passed) bySuite[r.suite].passed++;
  }
  for (const s of Object.values(bySuite)) s.accuracy = s.passed / (s.total || 1);

  const fpCases = actionableCases.filter(c => !c.expectedPos && c.actualPos).length;
  const irrelevantTotal = actionableCases.filter(c => !c.expectedPos).length;
  const fnCases = actionableCases.filter(c => c.expectedPos && !c.actualPos).length;
  const actionableTotal = actionableCases.filter(c => c.expectedPos).length;

  return {
    total,
    overallAccuracy: results.filter(r => r.passed).length / (total || 1),
    actionable,
    urgencyUrgent: binary(urgentCases),
    sensitivitySensitive: binary(sensitiveCases),
    safetyCriticalRecall: safetyTotal === 0 ? 1 : safetyCorrect / safetyTotal,
    categoryAccuracy: acc("primaryCategory"),
    ownerAccuracy: acc("recommendedOwner"),
    routeAccuracy: acc("routeType"),
    slackEligibilityAccuracy: acc("slackEligible"),
    manualReviewAccuracy: acc("manualReviewRequired"),
    falsePositiveRate: irrelevantTotal === 0 ? 0 : fpCases / irrelevantTotal,
    falseNegativeRate: actionableTotal === 0 ? 0 : fnCases / actionableTotal,
    byCategory,
    bySuite,
    failedFixtureIds: results.filter(r => !r.passed).map(r => r.fixtureId),
    safetyFailedFixtureIds: results.filter(r => !r.safetyPassed).map(r => r.fixtureId),
  };
}

// ── Thresholds ────────────────────────────────────────────────────────────────
// Recall on sensitive/safety-critical content is weighted above routine accuracy:
// a false negative there is worse than a category mismatch.
export interface Thresholds {
  safetyCriticalRecall: number;
  sensitivityRecall: number;
  actionableRecall: number;
  overallAccuracy: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  safetyCriticalRecall: 1.0, // never miss a declared safety-critical field
  sensitivityRecall: 0.9, // rarely miss private/sensitive content
  actionableRecall: 0.85, // rarely drop real work as irrelevant
  overallAccuracy: 0.7,
};

export interface ThresholdCheck {
  passed: boolean;
  failures: string[];
}

export function checkThresholds(m: EvalMetrics, t: Thresholds = DEFAULT_THRESHOLDS): ThresholdCheck {
  const failures: string[] = [];
  if (m.safetyCriticalRecall < t.safetyCriticalRecall)
    failures.push(`safetyCriticalRecall ${m.safetyCriticalRecall.toFixed(3)} < ${t.safetyCriticalRecall}`);
  if (m.sensitivitySensitive.recall < t.sensitivityRecall)
    failures.push(`sensitivityRecall ${m.sensitivitySensitive.recall.toFixed(3)} < ${t.sensitivityRecall}`);
  if (m.actionable.recall < t.actionableRecall)
    failures.push(`actionableRecall ${m.actionable.recall.toFixed(3)} < ${t.actionableRecall}`);
  if (m.overallAccuracy < t.overallAccuracy)
    failures.push(`overallAccuracy ${m.overallAccuracy.toFixed(3)} < ${t.overallAccuracy}`);
  return { passed: failures.length === 0, failures };
}
