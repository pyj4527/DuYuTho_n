import { prisma } from "../lib/prisma";
import type {
  PushPayload,
  PushSubscriptionRecordDto,
  PushSubscriptionUpsertRequestDto,
} from "../domain/dto";
import { mapPushSubscription } from "../mappers/push.mapper";
import { throwProblem } from "../lib/problem";
import { isAllowedPushEndpoint } from "../lib/push-endpoint-policy";
import { ensureHousehold } from "./household.service";

let webPush: typeof import("web-push") | undefined;

try {
  webPush = await import("web-push");
  configureWebPushClient();
} catch {
  webPush = undefined;
}

const base64UrlPattern = /^[A-Za-z0-9_-]+={0,2}$/;

export const pushService = {
  async getVapidPublicKey(): Promise<{ publicKey: string }> {
    return { publicKey: process.env.VAPID_PUBLIC_KEY ?? "" };
  },

  async upsertSubscription(
    householdId: string,
    input: PushSubscriptionUpsertRequestDto,
  ): Promise<{ record: PushSubscriptionRecordDto; created: boolean }> {
    await ensureHousehold(householdId);
    validateSubscription(input);

    const existing = await prisma.pushSubscription.findUnique({
      where: {
        householdId_endpoint: {
          householdId,
          endpoint: input.subscription.endpoint,
        },
      },
    });

    const subscription = await prisma.pushSubscription.upsert({
      where: {
        householdId_endpoint: {
          householdId,
          endpoint: input.subscription.endpoint,
        },
      },
      create: {
        householdId,
        endpoint: input.subscription.endpoint,
        expirationTime: input.subscription.expirationTime === null
          ? null
          : BigInt(Math.trunc(input.subscription.expirationTime)),
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        userAgent: input.userAgent,
        timezone: input.timezone,
        deviceLabel: input.deviceLabel,
        active: true,
      },
      update: {
        expirationTime: input.subscription.expirationTime === null
          ? null
          : BigInt(Math.trunc(input.subscription.expirationTime)),
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        userAgent: input.userAgent,
        timezone: input.timezone,
        deviceLabel: input.deviceLabel,
        active: true,
      },
    });

    return {
      record: mapPushSubscription(subscription),
      created: !existing,
    };
  },

  async listSubscriptions(householdId: string): Promise<PushSubscriptionRecordDto[]> {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { householdId, active: true },
      orderBy: [{ updatedAt: "desc" }],
    });

    return subscriptions.map(mapPushSubscription);
  },

  async deleteSubscription(householdId: string, subscriptionId: string): Promise<void> {
    const result = await prisma.pushSubscription.updateMany({
      where: { householdId, id: subscriptionId },
      data: { active: false },
    });

    if (result.count === 0) {
      throwProblem({ status: 404, title: "Not found", detail: "Push subscription not found" });
    }
  },

  async enqueueTestPush(
    householdId: string,
    subscriptionId: string | undefined,
  ): Promise<{ queued: true; sent: number; failed: number; inactiveIds: string[] }> {
    let subscriptions: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;

    if (subscriptionId) {
      const sub = await prisma.pushSubscription.findFirst({
        where: { householdId, id: subscriptionId, active: true },
      });
      if (!sub) {
        throwProblem({ status: 404, title: "Not found", detail: "Push subscription not found" });
      }
      subscriptions = [sub];
    } else {
      subscriptions = await prisma.pushSubscription.findMany({
        where: { householdId, active: true },
      });
    }

    if (subscriptions.length === 0) {
      throwProblem({ status: 404, title: "Not found", detail: "No active push subscriptions" });
    }

    const pushClient = configureWebPushClient();
    if (!pushClient) {
      throwProblem({
        status: 503,
        title: "Push provider unavailable",
        detail: "VAPID keys are not configured on the server",
      });
    }

    const payload = {
      title: "잔반제로 - 푸시 테스트",
      body: "푸시 알림이 정상적으로 수신되었습니다.",
      icon: "/icon-192x192.png",
      badge: "/icon-96x96.png",
      tag: "test-push",
      url: "/",
    };

    const { sent, failed, inactiveIds } = await sendPayloadToSubscriptions(subscriptions, payload, pushClient);

    return { queued: true, sent, failed, inactiveIds };
  },

  async sendPayloadToActiveSubscriptions(
    householdId: string,
    payload: PushPayload,
  ): Promise<{ sent: number; failed: number; inactiveIds: string[] }> {
    const pushClient = configureWebPushClient();
    if (!pushClient) {
      throwProblem({
        status: 503,
        title: "Push provider unavailable",
        detail: "VAPID keys are not configured on the server",
      });
    }

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { householdId, active: true },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0, inactiveIds: [] };
    }

    return sendPayloadToSubscriptions(subscriptions, payload, pushClient);
  },
};

function configureWebPushClient(): typeof import("web-push") | undefined {
  if (!webPush) {
    return undefined;
  }

  const subject = process.env.VAPID_SUBJECT?.trim();
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!subject || !publicKey || !privateKey) {
    return undefined;
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  return webPush;
}

function getPushErrorStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return undefined;
  }

  const { statusCode } = error;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function shouldDeactivatePushSubscription(statusCode: number | undefined): boolean {
  return statusCode === 400 || statusCode === 403 || statusCode === 404 || statusCode === 410;
}

async function sendPayloadToSubscriptions(
  subscriptions: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload,
  pushClient: typeof import("web-push"),
): Promise<{ sent: number; failed: number; inactiveIds: string[] }> {
  const inactiveIds: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    };

    try {
      await pushClient.sendNotification(pushSubscription, JSON.stringify(payload));
      await prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: { lastSuccessAt: new Date() },
      });
      sent++;
    } catch (error: unknown) {
      failed++;
      const statusCode = getPushErrorStatusCode(error);
      if (shouldDeactivatePushSubscription(statusCode)) {
        await prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { active: false, lastFailureAt: new Date() },
        });
        inactiveIds.push(subscription.id);
      } else {
        await prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { lastFailureAt: new Date() },
        });
      }
    }
  }

  return { sent, failed, inactiveIds };
}

function validateSubscription(input: PushSubscriptionUpsertRequestDto): void {
  if (!isAllowedPushEndpoint(input.subscription.endpoint)) {
    throwProblem({
      status: 422,
      title: "Validation error",
      detail: "push endpoint must be an HTTPS URL from an approved Web Push provider",
    });
  }
  if (!base64UrlPattern.test(input.subscription.keys.p256dh)) {
    throwProblem({ status: 422, title: "Validation error", detail: "keys.p256dh must be URL-safe base64" });
  }
  if (!base64UrlPattern.test(input.subscription.keys.auth)) {
    throwProblem({ status: 422, title: "Validation error", detail: "keys.auth must be URL-safe base64" });
  }
}
