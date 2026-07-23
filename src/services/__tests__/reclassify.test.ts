import { describe, test, expect } from "vitest";
import { isDowngrade } from "@/src/services/reclassify";
import type { ClassificationFields } from "@/src/services/effectiveClassification";

const base: ClassificationFields = {
  relevance: "actionable",
  urgency_level: "urgent",
  sensitivity_level: "sensitive",
  primary_category: "app_or_software",
  recommended_owner: "engineering",
  route_type: "manual_review",
  slack_eligible: false,
  manual_review_required: true,
  summary: null,
  recommended_next_step: null,
};

describe("isDowngrade — guards against silent downgrade", () => {
  test("sensitive → public_internal is a downgrade", () => {
    expect(isDowngrade(base, { ...base, sensitivity_level: "public_internal" })).toBe(true);
  });
  test("urgent → normal is a downgrade", () => {
    expect(isDowngrade(base, { ...base, urgency_level: "normal" })).toBe(true);
  });
  test("same or higher is not a downgrade", () => {
    expect(isDowngrade(base, { ...base })).toBe(false);
    const lower = { ...base, urgency_level: "normal", sensitivity_level: "public_internal" };
    expect(isDowngrade(lower, base)).toBe(false); // upgrade
  });
  test("category/owner change without urgency/sensitivity drop is not a downgrade", () => {
    expect(isDowngrade(base, { ...base, recommended_owner: "customer_success", primary_category: "unclear" })).toBe(false);
  });
});
