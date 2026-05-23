import type { PushSubscription } from "../../generated/prisma/client";
import type { PushSubscriptionRecordDto } from "../domain/dto";
import { toRfc3339 } from "../lib/date";

export function mapPushSubscription(subscription: PushSubscription): PushSubscriptionRecordDto {
  return {
    id: subscription.id,
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime === null
      ? null
      : Number(subscription.expirationTime),
    userAgent: subscription.userAgent ?? undefined,
    timezone: subscription.timezone,
    active: subscription.active,
    createdAt: toRfc3339(subscription.createdAt),
    updatedAt: toRfc3339(subscription.updatedAt),
    lastSuccessAt: subscription.lastSuccessAt ? toRfc3339(subscription.lastSuccessAt) : undefined,
    lastFailureAt: subscription.lastFailureAt ? toRfc3339(subscription.lastFailureAt) : undefined,
  };
}
