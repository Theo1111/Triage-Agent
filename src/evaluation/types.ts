import type {
  UrgencyLevel,
  SensitivityLevel,
  PrimaryCategory,
  RecommendedOwner,
  RouteType,
} from "./vocabulary";

// An expected value may be a single exact label or an acceptable set (multiple
// valid outcomes). A field is scored correct if the actual value is in the set.
export type Expect<T> = T | T[];

export type EvalSuite =
  | "unit"
  | "regression"
  | "safety"
  | "thread-lifecycle"
  | "routing";

export type SenderType =
  | "resident"
  | "property_manager"
  | "internal"
  | "vendor"
  | "prospect"
  | "unknown";

// Which classification fields are safety-critical for this fixture. A miss on
// any of these is weighted far more heavily than a routine category mismatch.
export type SafetyField =
  | "relevance"
  | "urgency"
  | "sensitivity"
  | "primaryCategory"
  | "recommendedOwner"
  | "routeType"
  | "slackEligible"
  | "manualReviewRequired";

export interface EvalExpected {
  // actionable = urgency !== not_relevant; irrelevant otherwise.
  relevance: Expect<"actionable" | "irrelevant">;
  urgency: Expect<UrgencyLevel>;
  sensitivity: Expect<SensitivityLevel>;
  primaryCategory: Expect<PrimaryCategory>;
  recommendedOwner: Expect<RecommendedOwner>;
  routeType: Expect<RouteType>;
  slackEligible: boolean;
  manualReviewRequired: boolean;
}

export interface ThreadContextFixture {
  isThreadReply: boolean;
  priorMessageCount: number;
  existingStatus?: string | null;
}

export interface EvalFixture {
  id: string;
  suite: EvalSuite;
  subject: string;
  body: string;
  senderType: SenderType;
  inbox: string;
  threadContext?: ThreadContextFixture;
  expected: EvalExpected;
  explanation: string;
  // Fields that must never be missed for this fixture (weighted safety recall).
  safetyCritical?: SafetyField[];
}

// A concrete classifier output projected into the evaluation field space.
export interface EvalActual {
  relevance: "actionable" | "irrelevant";
  urgency: UrgencyLevel;
  sensitivity: SensitivityLevel;
  primaryCategory: PrimaryCategory;
  recommendedOwner: RecommendedOwner;
  routeType: RouteType;
  slackEligible: boolean;
  manualReviewRequired: boolean;
}

export interface FieldScore {
  field: SafetyField;
  expected: string;
  actual: string;
  correct: boolean;
  safetyCritical: boolean;
}

export interface ScoredResult {
  fixtureId: string;
  suite: EvalSuite;
  passed: boolean; // all fields correct
  safetyPassed: boolean; // all safety-critical fields correct
  fields: FieldScore[];
  actual: EvalActual;
}
