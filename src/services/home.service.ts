import { prisma } from "../lib/prisma";
import type { ExpiryCalendarMonthDto, HomeSummaryDto } from "../domain/dto";
import { calculateDaysLeft, formatLocalDate } from "../lib/date";

export const homeService = {
  async getSummary(householdId: string): Promise<HomeSummaryDto> {
    const items = await prisma.inventoryItem.findMany({
      where: { householdId, status: "active" },
      select: { location: true, expiresAt: true },
    });

    const totalItemsCount = items.length;
    const fridgeCount = items.filter((item) => item.location === "냉장").length;
    const freezerCount = items.filter((item) => item.location === "냉동").length;
    const roomTempCount = items.filter((item) => item.location === "실온").length;
    const overdueCount = items.filter((item) => calculateDaysLeft(item.expiresAt) < 0).length;
    const soonCount = items.filter((item) => {
      const daysLeft = calculateDaysLeft(item.expiresAt);
      return daysLeft >= 0 && daysLeft <= 2;
    }).length;
    const todayCount = items.filter((item) => calculateDaysLeft(item.expiresAt) === 0).length;
    const priorityCount = soonCount + overdueCount;

    return {
      totalItemsCount,
      fridgeCount,
      freezerCount,
      roomTempCount,
      soonCount,
      overdueCount,
      priorityCount,
      todayCount,
      state: buildHomeState(totalItemsCount, soonCount, overdueCount),
      generatedAt: new Date().toISOString(),
    };
  },

  async getExpiryCalendar(
    householdId: string,
    year: number,
    month: number,
  ): Promise<ExpiryCalendarMonthDto> {
    const start = formatLocalDate(new Date(year, month - 1, 1));
    const end = formatLocalDate(new Date(year, month, 0));
    const items = await prisma.inventoryItem.findMany({
      where: {
        householdId,
        status: "active",
        expiresAt: { gte: start, lte: end },
      },
      select: { id: true, name: true, expiresAt: true },
      orderBy: [{ expiresAt: "asc" }, { name: "asc" }],
    });

    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const date = formatLocalDate(new Date(year, month - 1, index + 1));
      const expiringItems = items.filter((item) => item.expiresAt === date);
      const tone = getDayTone(expiringItems.map((item) => item.expiresAt));
      const representative = expiringItems[0];

      return {
        date,
        count: expiringItems.length,
        tone,
        representativeItemName: representative?.name,
        itemIds: expiringItems.map((item) => item.id),
      };
    });

    return {
      year,
      month,
      days,
    };
  },
};

function buildHomeState(
  totalItemsCount: number,
  soonCount: number,
  overdueCount: number,
): HomeSummaryDto["state"] {
  if (totalItemsCount === 0) {
    return {
      id: "empty",
      label: "비어 있음",
      title: "냉장고가 비어 있습니다",
      description: "AI 렌즈로 영수증이나 냉장고 내부를 촬영하여 식재료를 채워보세요.",
      tone: "empty",
    };
  }

  if (overdueCount > 0) {
    return {
      id: "overdue",
      label: "확인 필요",
      title: `기한 초과 재료 ${overdueCount}개 감지!`,
      description: "상태를 신속하게 확인하고 폐기 여부를 결정하거나 즉시 소진해보세요.",
      tone: "danger",
    };
  }

  if (soonCount > 0) {
    return {
      id: "expiring",
      label: "임박 알림",
      title: `소비기한 임박 재료 ${soonCount}개`,
      description: "오늘 또는 내일 내에 사용할 재료들이 있습니다. 추천 레시피로 소진해보세요.",
      tone: "warning",
    };
  }

  return {
    id: "default",
    label: "안정",
    title: "보관 중인 식재료가 모두 안전합니다",
    description: "식재료 낭비 제로! 오늘 어울리는 레시피를 확인해보세요.",
    tone: "ready",
  };
}

function getDayTone(expiresAtValues: string[]): "none" | "safe" | "soon" | "danger" {
  if (expiresAtValues.length === 0) {
    return "none";
  }
  if (expiresAtValues.some((expiresAt) => calculateDaysLeft(expiresAt) < 0)) {
    return "danger";
  }
  if (expiresAtValues.some((expiresAt) => {
    const daysLeft = calculateDaysLeft(expiresAt);
    return daysLeft >= 0 && daysLeft <= 2;
  })) {
    return "soon";
  }
  return "safe";
}
