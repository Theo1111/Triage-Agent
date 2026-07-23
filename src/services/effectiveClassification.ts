// Single source of truth for the "effective" classification of a case — the AI
// result with any human correction layered on top, per field. The dashboard,
// Slack, analytics, Paperclip, and evaluation exports MUST all derive the shown
// value from here so they cannot disagree about what a case is currently
// classified as. The original AI result is never mutated.

export interface ClassificationFields {
  relevance: "actionable" | "irrelevant";
  urgency_level: string;
  sensitivity_level: string;
  primary_category: string | null;
  recommended_owner: string | null;
  route_type: string;
  slack_eligible: boolean;
  manual_review_required: boolean;
  summary: string | null;
  recommended_next_step: string | null;
}

// A correction row projected into the same field space. A null/undefined field
// means "not corrected" — defer to the AI value.
export interface CorrectionFields {
  relevance?: string | null;
  urgency_level?: string | null;
  sensitivity_level?: string | null;
  primary_category?: string | null;
  recommended_owner?: string | null;
  route_type?: string | null;
  slack_eligible?: boolean | null;
  manual_review_required?: boolean | null;
  summary?: string | null;
  recommended_next_step?: string | null;
  id?: string;
  operator_username?: string;
  created_at?: string | Date;
}

// Build the AI field snapshot from a triage item + its current classification.
// Centralized so every surface projects the AI classification identically.
export function aiFieldsFromTriage(
  item: {
    urgency_level: string;
    sensitivity_level: string;
    route_type: string;
    owner: string | null;
    summary: string | null;
    recommended_next_step: string | null;
    status: string;
  },
  classification: { primary_category: string | null; recommended_owner: string | null } | null
): ClassificationFields {
  return {
    relevance: item.urgency_level === "not_relevant" ? "irrelevant" : "actionable",
    urgency_level: item.urgency_level,
    sensitivity_level: item.sensitivity_level,
    primary_category: classification?.primary_category ?? null,
    recommended_owner: classification?.recommended_owner ?? item.owner,
    route_type: item.route_type,
    slack_eligible:
      item.urgency_level === "urgent" &&
      item.sensitivity_level === "public_internal" &&
      item.route_type === "slack_channel",
    manual_review_required: item.status === "manual_review" || item.route_type === "manual_review",
    summary: item.summary,
    recommended_next_step: item.recommended_next_step,
  };
}

export type FieldSource = "ai" | "human";

export type EffectiveClassification = ClassificationFields & {
  sources: Record<keyof ClassificationFields, FieldSource>;
  hasHumanCorrection: boolean;
  correctionId: string | null;
  correctedBy: string | null;
  correctedAt: string | null;
};

const FIELD_KEYS: (keyof ClassificationFields)[] = [
  "relevance",
  "urgency_level",
  "sensitivity_level",
  "primary_category",
  "recommended_owner",
  "route_type",
  "slack_eligible",
  "manual_review_required",
  "summary",
  "recommended_next_step",
];

function corrected<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function computeEffectiveClassification(
  ai: ClassificationFields,
  correction: CorrectionFields | null
): EffectiveClassification {
  const sources = {} as Record<keyof ClassificationFields, FieldSource>;
  const merged = { ...ai };
  let anyHuman = false;

  if (correction) {
    for (const key of FIELD_KEYS) {
      const cv = (correction as unknown as Record<string, unknown>)[key];
      if (corrected(cv)) {
        (merged as unknown as Record<string, unknown>)[key] = cv;
        sources[key] = "human";
        anyHuman = true;
      } else {
        sources[key] = "ai";
      }
    }
  } else {
    for (const key of FIELD_KEYS) sources[key] = "ai";
  }

  const at = correction?.created_at;
  return {
    ...merged,
    sources,
    hasHumanCorrection: anyHuman,
    correctionId: correction?.id ?? null,
    correctedBy: anyHuman ? correction?.operator_username ?? null : null,
    correctedAt: anyHuman ? (at instanceof Date ? at.toISOString() : at ?? null) : null,
  };
}

// The list of fields that were actually changed (for audit + display).
export function changedFields(
  ai: ClassificationFields,
  correction: CorrectionFields
): Array<{ field: string; from: unknown; to: unknown }> {
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const key of FIELD_KEYS) {
    const cv = (correction as Record<string, unknown>)[key];
    if (corrected(cv) && cv !== (ai as unknown as Record<string, unknown>)[key]) {
      changes.push({ field: key, from: (ai as unknown as Record<string, unknown>)[key], to: cv });
    }
  }
  return changes;
}
