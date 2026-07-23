import { describe, test, expect } from "vitest";
import { EmailTriageOutputSchema } from "@/src/agents/emailTriageAgent";
import {
  URGENCY_LEVELS,
  SENSITIVITY_LEVELS,
  PRIMARY_CATEGORIES,
  RECOMMENDED_OWNERS,
  ROUTE_TYPES,
} from "@/src/evaluation/vocabulary";

// Guards against drift between the evaluation vocabulary and the agent's zod
// schema. If the schema changes, this test fails until the corpus vocabulary
// (and any dependent fixtures) is updated — never invent new labels silently.
describe("evaluation vocabulary matches the agent schema", () => {
  const shape = EmailTriageOutputSchema.shape;

  test("urgency_level", () => {
    expect([...(shape.urgency_level as any).options].sort()).toEqual([...URGENCY_LEVELS].sort());
  });
  test("sensitivity_level", () => {
    expect([...(shape.sensitivity_level as any).options].sort()).toEqual([...SENSITIVITY_LEVELS].sort());
  });
  test("primary_category", () => {
    expect([...(shape.primary_category as any).options].sort()).toEqual([...PRIMARY_CATEGORIES].sort());
  });
  test("recommended_owner", () => {
    expect([...(shape.recommended_owner as any).options].sort()).toEqual([...RECOMMENDED_OWNERS].sort());
  });
  test("route_type", () => {
    expect([...(shape.route_type as any).options].sort()).toEqual([...ROUTE_TYPES].sort());
  });
});
