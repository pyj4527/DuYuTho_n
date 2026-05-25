import { prisma } from "../lib/prisma";
import { calculateDaysLeft, toRfc3339 } from "../lib/date";
import type {
  NotificationDispatchResultDto,
  NotificationPreferenceResponseDto,
  NotificationPreferenceUpdateDto,
  NotificationPreviewDto,
  PushPayload,
} from "../domain/dto";
import { mapNotifications } from "../mappers/profile.mapper";
import { ensureHousehold } from "./household.service";
import { pushService } from "./push.service";

type SettingsLike = {
  expiryReminderEnabled: boolean;
  expiryReminderDaysBefore: number[];
  expiryReminderTime: string;
  recipeConsumeReminderEnabled: boolean;
  reviewPendingReminderEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

export const notificationService = {
  async getPreferences(householdId: string): Promise<NotificationPreferenceResponseDto> {
    const household = await ensureHousehold(householdId);
    const recommendation = await recommendNotificationTime(householdId, household.settings.expiryReminderTime);

    return {
      ...mapNotifications(household.settings),
      recommendedTime: recommendation.time,
      recommendationReason: recommendation.reason,
    };
  },

  async updatePreferences(
    householdId: string,
    input: NotificationPreferenceUpdateDto,
  ): Promise<NotificationPreferenceResponseDto> {
    await ensureHousehold(householdId);
    const data: Record<string, unknown> = {};

    if (input.expiryReminderEnabled !== undefined) data.expiryReminderEnabled = input.expiryReminderEnabled;
    if (input.expiryReminderDaysBefore !== undefined) {
      data.expiryReminderDaysBefore = normalizeReminderDays(input.expiryReminderDaysBefore);
    }
    if (input.expiryReminderTime !== undefined) data.expiryReminderTime = normalizeTime(input.expiryReminderTime);
    if (input.recipeConsumeReminderEnabled !== undefined) {
      data.recipeConsumeReminderEnabled = input.recipeConsumeReminderEnabled;
    }
    if (input.reviewPendingReminderEnabled !== undefined) {
      data.reviewPendingReminderEnabled = input.reviewPendingReminderEnabled;
    }
    if (input.quietHours !== undefined) {
      data.quietHoursStart = input.quietHours?.start ? normalizeTime(input.quietHours.start) : null;
      data.quietHoursEnd = input.quietHours?.end ? normalizeTime(input.quietHours.end) : null;
    }

    if (Object.keys(data).length > 0) {
      await prisma.householdSettings.update({ where: { householdId }, data });
    }

    return this.getPreferences(householdId);
  },

  async preview(householdId: string): Promise<NotificationPreviewDto> {
    const household = await ensureHousehold(householdId);
    const recommendation = await recommendNotificationTime(householdId, household.settings.expiryReminderTime);
    const items = await getDueItems(householdId);
    const needsReviewCount = await countNeedsReviewItems(householdId);

    return buildNotificationPreview({
      generatedAt: new Date(),
      items,
      needsReviewCount,
      recommendedTime: recommendation.time,
      settings: household.settings,
    });
  },

  async dispatchDue(
    householdId: string,
    input: { dryRun?: boolean } = {},
  ): Promise<NotificationDispatchResultDto> {
    const preview = await this.preview(householdId);
    const payloads = preview.nextNotifications.map(notificationToPushPayload);
    if (input.dryRun || payloads.length === 0) {
      return { queued: true, dryRun: true, sent: 0, failed: 0, inactiveIds: [], payloads };
    }

    let sent = 0;
    let failed = 0;
    const inactiveIds: string[] = [];

    for (const payload of payloads) {
      const result = await pushService.sendPayloadToActiveSubscriptions(householdId, payload);
      sent += result.sent;
      failed += result.failed;
      inactiveIds.push(...result.inactiveIds);
    }

    return { queued: true, dryRun: false, sent, failed, inactiveIds, payloads };
  },
};

export function buildNotificationPreview({
  generatedAt,
  items,
  needsReviewCount,
  recommendedTime,
  settings,
}: {
  generatedAt: Date;
  items: NotificationPreviewDto["items"];
  needsReviewCount: number;
  recommendedTime: string;
  settings: SettingsLike;
}): NotificationPreviewDto {
  const todayCount = items.filter((item) => item.bucket === "today").length;
  const overdueCount = items.filter((item) => item.bucket === "overdue").length;
  const soonCount = items.filter((item) => item.bucket === "soon").length;
  const priorityNames = items.slice(0, 3).map((item) => item.name);
  const title = overdueCount > 0
    ? `소비기한 지난 재료 ${overdueCount}개 확인`
    : todayCount > 0
      ? `오늘 먹어야 할 재료 ${todayCount}개`
      : soonCount > 0
        ? `곧 먹어야 할 재료 ${soonCount}개`
        : "오늘 냉장고 상태 안정";
  const body = priorityNames.length > 0
    ? `${priorityNames.join(", ")}부터 확인하세요.`
    : needsReviewCount > 0
      ? `확인 필요한 재료 ${needsReviewCount}개가 있습니다.`
      : "소비기한 임박 재료가 없습니다.";
  const nextNotifications: NotificationPreviewDto["nextNotifications"] = [];

  if (settings.expiryReminderEnabled && (todayCount > 0 || soonCount > 0)) {
    nextNotifications.push({
      type: "today_summary",
      scheduledLocalTime: recommendedTime,
      title,
      body,
      tag: "today-to-eat",
      url: "/inventory",
    });
  }
  if (settings.expiryReminderEnabled && overdueCount > 0) {
    nextNotifications.push({
      type: "expiry_overdue",
      scheduledLocalTime: recommendedTime,
      title: `기한 초과 재료 ${overdueCount}개`,
      body: items.filter((item) => item.bucket === "overdue").slice(0, 3).map((item) => item.name).join(", "),
      tag: "expiry-overdue",
      url: "/inventory",
    });
  }
  if (settings.reviewPendingReminderEnabled && needsReviewCount > 0) {
    nextNotifications.push({
      type: "review_pending",
      scheduledLocalTime: recommendedTime,
      title: `확인 필요한 식재료 ${needsReviewCount}개`,
      body: "수량, 소비기한, 중복 여부를 확인하세요.",
      tag: "review-pending",
      url: "/lens",
    });
  }

  return {
    generatedAt: toRfc3339(generatedAt),
    recommendedTime,
    summary: { todayCount, overdueCount, soonCount, needsReviewCount, title, body },
    items,
    nextNotifications,
  };
}

async function getDueItems(householdId: string): Promise<NotificationPreviewDto["items"]> {
  const items = await prisma.inventoryItem.findMany({
    where: { householdId, status: "active" },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    take: 50,
  });

  return items
    .map((item) => {
      const daysLeft = calculateDaysLeft(item.expiresAt);
      const bucket = daysLeft < 0 ? "overdue" : daysLeft === 0 ? "today" : daysLeft <= 2 ? "soon" : null;
      return bucket ? { id: item.id, name: item.name, expiresAt: item.expiresAt, daysLeft, bucket } : null;
    })
    .filter((item): item is NotificationPreviewDto["items"][number] => item !== null);
}

async function countNeedsReviewItems(householdId: string): Promise<number> {
  return prisma.inventoryItem.count({
    where: {
      householdId,
      status: "active",
      memo: { contains: "[review:needs_review" },
    },
  });
}

async function recommendNotificationTime(
  householdId: string,
  fallbackTime: string,
): Promise<{ time: string; reason: string }> {
  const logs = await prisma.recipeConsumptionLog.findMany({
    where: { householdId },
    orderBy: [{ consumedAt: "desc" }],
    take: 30,
  });
  if (logs.length === 0) {
    return {
      time: normalizeTime(fallbackTime),
      reason: "아직 식사 패턴 데이터가 부족해 현재 설정 시간을 추천합니다.",
    };
  }

  const hourCounts = new Map<number, number>();
  for (const log of logs) {
    const hour = log.consumedAt.getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const [hour] = Array.from(hourCounts.entries()).sort((left, right) => right[1] - left[1])[0] ?? [9, 0];
  const recommendedHour = Math.max(7, Math.min(21, hour - 2));
  return {
    time: `${String(recommendedHour).padStart(2, "0")}:00`,
    reason: "최근 요리 완료 시간보다 약 2시간 빠르게 알려 소비 준비 시간을 확보합니다.",
  };
}

function notificationToPushPayload(notification: NotificationPreviewDto["nextNotifications"][number]): PushPayload {
  return {
    title: `잔반제로 - ${notification.title}`,
    body: notification.body,
    icon: "/icon-192x192.png",
    badge: "/icon-96x96.png",
    tag: notification.tag,
    url: notification.url,
  };
}

function normalizeReminderDays(days: number[]): number[] {
  return Array.from(new Set(days.map((day) => Math.trunc(day)).filter((day) => day >= -7 && day <= 14)))
    .sort((left, right) => left - right);
}

function normalizeTime(value: string): string {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : "09:00";
}
