export type UserRole = "admin" | "operations" | "engineering" | "customer_success" | "viewer";

const USER_ROLES: Record<string, UserRole> = {
  tblumberg: "admin",
};

export function getUserRole(username: string): UserRole {
  return USER_ROLES[username.toLowerCase()] ?? "viewer";
}

export type TeamTab =
  | "all"
  | "operations"
  | "engineering"
  | "customer_success"
  | "field_ops"
  | "manual_review"
  | "urgent_open"
  | "assigned"
  | "resolved"
  | "archived";

export const TEAM_TABS: { id: TeamTab; label: string }[] = [
  { id: "all", label: "All Open" },
  { id: "urgent_open", label: "🔴 Urgent" },
  { id: "assigned", label: "Assigned" },
  { id: "manual_review", label: "Manual Review" },
  { id: "operations", label: "Operations" },
  { id: "engineering", label: "Engineering" },
  { id: "customer_success", label: "Customer Success" },
  { id: "field_ops", label: "Field Ops" },
  { id: "resolved", label: "Resolved" },
  { id: "archived", label: "Archived" },
];
