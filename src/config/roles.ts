export type UserRole = "admin" | "operations" | "engineering" | "customer_success" | "viewer";

const USER_ROLES: Record<string, UserRole> = {
  tblumberg: "admin",
};

export function getUserRole(username: string): UserRole {
  return USER_ROLES[username.toLowerCase()] ?? "viewer";
}

// Teams an operator can hand a case to (matches the recommended_owner buckets
// the triage agent produces for routing). Used to validate team assignment and
// to power the team queue views.
export const ASSIGNABLE_TEAMS = [
  "operations",
  "engineering",
  "customer_success",
  "field_ops",
] as const;
export type AssignableTeam = (typeof ASSIGNABLE_TEAMS)[number];

export const TEAM_LABELS: Record<string, string> = {
  operations: "Operations",
  engineering: "Engineering",
  customer_success: "Customer Success",
  field_ops: "Field Ops",
};

export function isAssignableTeam(value: string): value is AssignableTeam {
  return (ASSIGNABLE_TEAMS as readonly string[]).includes(value);
}

export type TeamTab =
  | "all"
  | "my_queue"
  | "unassigned"
  | "urgent_open"
  | "escalated"
  | "manual_review"
  | "assigned"
  | "operations"
  | "engineering"
  | "customer_success"
  | "field_ops"
  | "sla_breached"
  | "resolved"
  | "archived";

// Queue navigation. Order groups: overview → my work → priority → teams → closed.
export const TEAM_TABS: { id: TeamTab; label: string }[] = [
  { id: "all", label: "All Open" },
  { id: "my_queue", label: "My Queue" },
  { id: "unassigned", label: "Unassigned" },
  { id: "urgent_open", label: "🔴 Urgent" },
  { id: "escalated", label: "Escalated" },
  { id: "manual_review", label: "Manual Review" },
  { id: "assigned", label: "Assigned" },
  { id: "operations", label: "Operations" },
  { id: "engineering", label: "Engineering" },
  { id: "customer_success", label: "Customer Success" },
  { id: "field_ops", label: "Field Ops" },
  { id: "sla_breached", label: "SLA Breached" },
  { id: "resolved", label: "Resolved" },
  { id: "archived", label: "Archived" },
];
