// Server-side validation for triage assignment. Ensures we never store an
// arbitrary free-text owner when a real operator is required: person
// assignments must resolve to a known operator_profiles row, team assignments
// must be one of the known teams, and "self" is derived from the authenticated
// session (never trusted from the client).

import { listOperatorProfiles, type OperatorProfilePublic } from "@/src/services/operatorProfiles";
import { isAssignableTeam, TEAM_LABELS } from "@/src/config/roles";

export type OwnerKind = "self" | "operator" | "team";

export interface ResolveAssignmentInput {
  ownerKind: OwnerKind;
  // For "operator": an operator id (uuid) or username. Ignored for "self".
  owner?: string | null;
  actingOperator: OperatorProfilePublic;
}

export interface ResolvedAssignment {
  // Value stored in triage_items.owner.
  owner: string;
  // Friendly label for logs / Slack / UI.
  label: string;
}

export async function resolveAssignmentOwner(
  input: ResolveAssignmentInput
): Promise<ResolvedAssignment> {
  const { ownerKind, owner, actingOperator } = input;

  if (ownerKind === "self") {
    return {
      owner: actingOperator.username,
      label: actingOperator.displayName || actingOperator.username,
    };
  }

  if (ownerKind === "team") {
    const team = (owner ?? "").trim();
    if (!isAssignableTeam(team)) {
      throw new Error(`invalid_team: "${team}" is not an assignable team`);
    }
    return { owner: team, label: TEAM_LABELS[team] ?? team };
  }

  if (ownerKind === "operator") {
    const needle = (owner ?? "").trim();
    if (!needle) throw new Error("invalid_owner: operator identifier is required");
    const profiles = await listOperatorProfiles();
    const match = profiles.find(
      p => p.id === needle || p.username.toLowerCase() === needle.toLowerCase()
    );
    if (!match) {
      throw new Error(`unknown_operator: no operator profile matches "${needle}"`);
    }
    return { owner: match.username, label: match.displayName || match.username };
  }

  throw new Error(`invalid_owner_kind: "${ownerKind}"`);
}
