import { describe, expect, it } from "bun:test";
import { buildNotificationPreview } from "./notification.service";

describe("notification preview", () => {
  it("summarizes today, overdue, soon, and review pending notifications", () => {
    const preview = buildNotificationPreview({
      generatedAt: new Date("2026-05-25T00:00:00.000Z"),
      recommendedTime: "08:00",
      needsReviewCount: 2,
      settings: {
        expiryReminderEnabled: true,
        expiryReminderDaysBefore: [2, 0],
        expiryReminderTime: "09:00",
        recipeConsumeReminderEnabled: true,
        reviewPendingReminderEnabled: true,
        quietHoursStart: null,
        quietHoursEnd: null,
      },
      items: [
        { id: "old", name: "두부", expiresAt: "2026-05-24", daysLeft: -1, bucket: "overdue" },
        { id: "today", name: "토마토", expiresAt: "2026-05-25", daysLeft: 0, bucket: "today" },
        { id: "soon", name: "가지", expiresAt: "2026-05-27", daysLeft: 2, bucket: "soon" },
      ],
    });

    expect(preview.summary).toMatchObject({
      todayCount: 1,
      overdueCount: 1,
      soonCount: 1,
      needsReviewCount: 2,
    });
    expect(preview.nextNotifications.map((notification) => notification.type)).toEqual([
      "today_summary",
      "expiry_overdue",
      "review_pending",
    ]);
  });
});
