import { describe, test, expect } from "vitest";
import {
  computeEffectiveClassification,
  changedFields,
  type ClassificationFields,
} from "@/src/services/effectiveClassification";

const ai: ClassificationFields = {
  relevance: "actionable",
  urgency_level: "normal",
  sensitivity_level: "public_internal",
  primary_category: "app_or_software",
  recommended_owner: "engineering",
  route_type: "dashboard_only",
  slack_eligible: false,
  manual_review_required: false,
  summary: "AI summary",
  recommended_next_step: "AI next step",
};

describe("computeEffectiveClassification", () => {
  test("no correction → all fields sourced from AI", () => {
    const eff = computeEffectiveClassification(ai, null);
    expect(eff.hasHumanCorrection).toBe(false);
    expect(eff.recommended_owner).toBe("engineering");
    expect(eff.sources.recommended_owner).toBe("ai");
    expect(eff.correctedBy).toBeNull();
  });

  test("partial correction overrides only corrected fields", () => {
    const eff = computeEffectiveClassification(ai, {
      id: "c1",
      operator_username: "op@grata.life",
      recommended_owner: "customer_success",
      urgency_level: "urgent",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(eff.recommended_owner).toBe("customer_success");
    expect(eff.sources.recommended_owner).toBe("human");
    expect(eff.urgency_level).toBe("urgent");
    expect(eff.sources.urgency_level).toBe("human");
    // Untouched fields stay AI.
    expect(eff.primary_category).toBe("app_or_software");
    expect(eff.sources.primary_category).toBe("ai");
    expect(eff.hasHumanCorrection).toBe(true);
    expect(eff.correctedBy).toBe("op@grata.life");
    expect(eff.correctedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("boolean false correction is honored (not treated as absent)", () => {
    const aiEligible = { ...ai, slack_eligible: true };
    const eff = computeEffectiveClassification(aiEligible, {
      id: "c2",
      operator_username: "op",
      slack_eligible: false,
    });
    expect(eff.slack_eligible).toBe(false);
    expect(eff.sources.slack_eligible).toBe("human");
  });

  test("null correction fields defer to AI", () => {
    const eff = computeEffectiveClassification(ai, {
      id: "c3",
      operator_username: "op",
      recommended_owner: null,
      summary: null,
    });
    expect(eff.recommended_owner).toBe("engineering");
    expect(eff.sources.recommended_owner).toBe("ai");
    expect(eff.hasHumanCorrection).toBe(false);
  });

  test("changedFields lists only real changes", () => {
    const changes = changedFields(ai, { recommended_owner: "customer_success", urgency_level: "normal" });
    // owner changed; urgency same as AI so excluded.
    expect(changes).toEqual([{ field: "recommended_owner", from: "engineering", to: "customer_success" }]);
  });
});
