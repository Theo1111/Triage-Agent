// Resolves the free-text `owner` column on a triage item to a friendly,
// consistent display — reconciling the three shapes that historically live in
// that column: canonical operator ids ("tblumberg"), operator emails
// ("tblumberg@grata.life"), and team/role labels ("engineering"). Client-safe:
// imports only pure config (no DB / no server-only modules).

import { canonicalOperator } from "@/src/config/operatorMap";
import { isAssignableTeam, TEAM_LABELS } from "@/src/config/roles";

export interface OperatorLite {
  id: string;
  username: string;
  displayName: string | null;
}

export type OwnerKind = "unassigned" | "team" | "operator" | "other";

export interface ResolvedOwner {
  kind: OwnerKind;
  label: string;
  operator?: OperatorLite;
  team?: string;
}

export function findOperatorForOwner(
  owner: string | null | undefined,
  operators: OperatorLite[]
): OperatorLite | undefined {
  if (!owner) return undefined;
  const raw = owner.toLowerCase();
  const canon = canonicalOperator(owner);
  return operators.find(op => {
    const uname = op.username.toLowerCase();
    if (uname === raw) return true;
    if (canonicalOperator(op.username) === canon && canon !== "") return true;
    if (op.displayName && op.displayName.toLowerCase() === raw) return true;
    return false;
  });
}

export function resolveOwner(
  owner: string | null | undefined,
  operators: OperatorLite[]
): ResolvedOwner {
  if (!owner || !owner.trim()) return { kind: "unassigned", label: "Unassigned" };

  if (isAssignableTeam(owner)) {
    return { kind: "team", label: TEAM_LABELS[owner] ?? owner, team: owner };
  }

  const op = findOperatorForOwner(owner, operators);
  if (op) {
    return { kind: "operator", label: op.displayName || op.username, operator: op };
  }

  // Unknown label (a legacy team like "leadership", or a free-text value).
  const teamLabel = TEAM_LABELS[owner];
  if (teamLabel) return { kind: "team", label: teamLabel, team: owner };
  return { kind: "other", label: owner };
}
