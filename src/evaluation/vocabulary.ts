// The agent's exact output vocabulary, mirrored here as const arrays so the
// evaluation corpus and scoring can be type-checked and validated without a
// model call. A drift test (src/evaluation/__tests__/vocabulary.test.ts) asserts
// these stay identical to EmailTriageOutputSchema — do NOT invent new values
// here without a corresponding schema change + migration.

export const URGENCY_LEVELS = ["urgent", "normal", "not_relevant"] as const;
export const SENSITIVITY_LEVELS = ["public_internal", "private", "sensitive"] as const;
export const PRIMARY_CATEGORIES = [
  "access_or_lockout",
  "app_or_software",
  "admin_portal",
  "hardware_or_device",
  "access_control",
  "ict_or_intercom",
  "cameras_or_security_video",
  "lpr_or_vehicle_access",
  "building_infrastructure",
  "leak_or_water",
  "thermostat_or_hvac",
  "customer_escalation",
  "engineering_blocker",
  "launch_or_qa_blocker",
  "sensitive_private",
  "not_relevant",
  "unclear",
] as const;
export const RECOMMENDED_OWNERS = [
  "operations",
  "customer_success",
  "engineering",
  "field_ops",
  "leadership",
  "hr_private",
  "legal_private",
  "finance_private",
  "manual_review",
  "ignore",
] as const;
export const ROUTE_TYPES = [
  "slack_channel",
  "private_owner",
  "dashboard_only",
  "manual_review",
  "ignore",
] as const;

export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];
export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];
export type PrimaryCategory = (typeof PRIMARY_CATEGORIES)[number];
export type RecommendedOwner = (typeof RECOMMENDED_OWNERS)[number];
export type RouteType = (typeof ROUTE_TYPES)[number];

export function isUrgency(v: string): v is UrgencyLevel {
  return (URGENCY_LEVELS as readonly string[]).includes(v);
}
export function isSensitivity(v: string): v is SensitivityLevel {
  return (SENSITIVITY_LEVELS as readonly string[]).includes(v);
}
export function isPrimaryCategory(v: string): v is PrimaryCategory {
  return (PRIMARY_CATEGORIES as readonly string[]).includes(v);
}
export function isRecommendedOwner(v: string): v is RecommendedOwner {
  return (RECOMMENDED_OWNERS as readonly string[]).includes(v);
}
export function isRouteType(v: string): v is RouteType {
  return (ROUTE_TYPES as readonly string[]).includes(v);
}
