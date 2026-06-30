import * as routingRepo from "@/src/repositories/routingRecommendationsRepository";
import type { RoutingRecommendation, RouteType } from "@/src/types/database";

export interface SaveRoutingRecommendationInput {
  inboundEmailId: string;
  classificationId?: string | null;
  routeType: RouteType;
  targetOwner?: string | null;
  targetOwnerEmail?: string | null;
  targetChannel?: string | null;
  recommendedAction?: string | null;
  routeReason?: string | null;
}

export async function saveRoutingRecommendation(
  input: SaveRoutingRecommendationInput
): Promise<RoutingRecommendation> {
  const recommendation = await routingRepo.insertAsCurrent({
    inboundEmailId: input.inboundEmailId,
    classificationId: input.classificationId ?? null,
    routeType: input.routeType,
    targetOwner: input.targetOwner ?? null,
    targetOwnerEmail: input.targetOwnerEmail ?? null,
    targetChannel: input.targetChannel ?? null,
    recommendedAction: input.recommendedAction ?? null,
    routeReason: input.routeReason ?? null,
  });

  console.log(
    `[routing] saved email=${input.inboundEmailId} ` +
    `route_type=${input.routeType} channel=${input.targetChannel ?? "—"} ` +
    `owner=${input.targetOwner ?? "—"}`
  );
  return recommendation;
}

export async function getCurrentRoutingRecommendation(
  inboundEmailId: string
): Promise<RoutingRecommendation | null> {
  return routingRepo.findCurrentByEmailId(inboundEmailId);
}
