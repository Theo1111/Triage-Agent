import type { EvalFixture } from "@/src/evaluation/types";
import {
  isUrgency,
  isSensitivity,
  isPrimaryCategory,
  isRecommendedOwner,
  isRouteType,
} from "@/src/evaluation/vocabulary";
import { toArray } from "@/src/evaluation/scoring";
import { unitFixtures } from "./unit";
import { safetyFixtures } from "./safety";
import { threadLifecycleFixtures } from "./threadLifecycle";
import { routingFixtures } from "./routing";
import { regressionFixtures } from "./regression";

export const allFixtures: EvalFixture[] = [
  ...unitFixtures,
  ...safetyFixtures,
  ...threadLifecycleFixtures,
  ...routingFixtures,
  ...regressionFixtures,
];

export const fixturesBySuite = {
  unit: unitFixtures,
  safety: safetyFixtures,
  "thread-lifecycle": threadLifecycleFixtures,
  routing: routingFixtures,
  regression: regressionFixtures,
};

// Structural validation of a fixture against the exact vocabulary. Returns the
// list of problems (empty = valid). Used by the offline runner and unit tests.
export function validateFixture(fx: EvalFixture): string[] {
  const problems: string[] = [];
  const e = fx.expected;
  const check = (label: string, vals: string[], pred: (v: string) => boolean) => {
    for (const v of vals) if (!pred(v)) problems.push(`${fx.id}: invalid ${label} "${v}"`);
  };
  check("urgency", toArray(e.urgency), isUrgency);
  check("sensitivity", toArray(e.sensitivity), isSensitivity);
  check("primaryCategory", toArray(e.primaryCategory), isPrimaryCategory);
  check("recommendedOwner", toArray(e.recommendedOwner), isRecommendedOwner);
  check("routeType", toArray(e.routeType), isRouteType);
  for (const r of toArray(e.relevance)) {
    if (r !== "actionable" && r !== "irrelevant") problems.push(`${fx.id}: invalid relevance "${r}"`);
  }
  if (!fx.subject && !fx.body) problems.push(`${fx.id}: empty subject and body`);
  return problems;
}

export function findDuplicateIds(fixtures: EvalFixture[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const fx of fixtures) {
    if (seen.has(fx.id)) dups.push(fx.id);
    seen.add(fx.id);
  }
  return dups;
}
