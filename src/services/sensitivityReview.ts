import * as sensitivityRepo from "@/src/repositories/sensitivityReviewsRepository";
import type { SensitivityReview, SensitivityReviewStatus } from "@/src/types/database";

export interface SaveSensitivityDecisionInput {
  inboundEmailId: string;
  classificationId?: string | null;
  isSensitive: boolean;
  sensitivityCategories?: string[];
  sharedSlackAllowed?: boolean;
  privateRouteRequired?: boolean;
  reason?: string | null;
  reviewStatus?: SensitivityReviewStatus;
}

export async function saveSensitivityDecision(
  input: SaveSensitivityDecisionInput
): Promise<SensitivityReview> {
  const review = await sensitivityRepo.insert({
    inboundEmailId: input.inboundEmailId,
    classificationId: input.classificationId ?? null,
    isSensitive: input.isSensitive,
    sensitivityCategories: input.sensitivityCategories ?? [],
    sharedSlackAllowed: input.sharedSlackAllowed ?? !input.isSensitive,
    privateRouteRequired: input.privateRouteRequired ?? false,
    reason: input.reason ?? null,
    reviewStatus: input.reviewStatus ?? "system_decision",
  });

  console.log(
    `[sensitivity] saved email=${input.inboundEmailId} ` +
    `sensitive=${input.isSensitive} slack_allowed=${review.shared_slack_allowed} ` +
    `private_required=${review.private_route_required}`
  );
  return review;
}

export async function getCurrentSensitivityReview(
  inboundEmailId: string
): Promise<SensitivityReview | null> {
  return sensitivityRepo.findLatestByEmailId(inboundEmailId);
}

export async function recordHumanReview(input: {
  reviewId: string;
  approved: boolean;
  reviewedBy: string;
}): Promise<void> {
  const status: SensitivityReviewStatus = input.approved
    ? "human_approved"
    : "human_overridden";
  await sensitivityRepo.updateReviewStatus({
    id: input.reviewId,
    reviewStatus: status,
    reviewedBy: input.reviewedBy,
  });
}
