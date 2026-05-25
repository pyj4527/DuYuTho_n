import { prisma } from "../lib/prisma";
import { toRfc3339 } from "../lib/date";
import { computeSpoilageRisk, getWeatherSpoilageImpact } from "../lib/spoilage-risk";
import type {
  InventoryItemDto,
  InventorySpoilageRiskItemDto,
  InventorySpoilageRiskReportDto,
  PushPayload,
  SpoilageRiskDispatchResultDto,
  SpoilageWeatherContextDto,
} from "../domain/dto";
import { mapInventoryItem } from "../mappers/inventory.mapper";
import { ensureHousehold } from "./household.service";
import { pushService } from "./push.service";
import { weatherService } from "./weather.service";

const sentAlertSignatures = new Map<string, string>();

export const spoilageRiskService = {
  async getReport(householdId: string): Promise<InventorySpoilageRiskReportDto> {
    await ensureHousehold(householdId);
    const [items, weather] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { householdId, status: "active" },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      }),
      weatherService.getCurrentSpoilageWeather(),
    ]);

    return buildInventorySpoilageRiskReport(items.map(mapInventoryItem), weather, new Date());
  },

  async dispatchSpoilageRiskAlerts(input: {
    dedupe?: boolean;
    dryRun?: boolean;
    householdIds?: string[];
  } = {}): Promise<SpoilageRiskDispatchResultDto> {
    const householdIds = input.householdIds ?? await getHouseholdsWithActivePushSubscriptions();
    let sent = 0;
    let failed = 0;
    let householdsNotified = 0;
    const inactiveIds: string[] = [];
    const payloads: PushPayload[] = [];

    for (const householdId of householdIds) {
      const report = await this.getReport(householdId);
      const payload = buildSpoilageRiskPushPayload(report);
      if (!payload) {
        continue;
      }

      const signature = buildAlertSignature(householdId, report);
      if (input.dedupe !== false && sentAlertSignatures.get(householdId) === signature) {
        continue;
      }

      payloads.push(payload);
      householdsNotified++;
      if (!input.dryRun) {
        const result = await pushService.sendPayloadToActiveSubscriptions(householdId, payload);
        sent += result.sent;
        failed += result.failed;
        inactiveIds.push(...result.inactiveIds);
        if (result.sent > 0) {
          sentAlertSignatures.set(householdId, signature);
        }
      }
    }

    return {
      queued: true,
      dryRun: Boolean(input.dryRun),
      householdsScanned: householdIds.length,
      householdsNotified,
      sent,
      failed,
      inactiveIds,
      payloads,
    };
  },
};

export function buildInventorySpoilageRiskReport(
  items: InventoryItemDto[],
  weather: SpoilageWeatherContextDto,
  generatedAt: Date,
): InventorySpoilageRiskReportDto {
  const riskItems = items
    .map((item) => buildSpoilageRiskItem(item, weather))
    .sort((left, right) => {
      if (left.spoilageRisk.score !== right.spoilageRisk.score) {
        return right.spoilageRisk.score - left.spoilageRisk.score;
      }
      return left.spoilageRisk.daysLeft - right.spoilageRisk.daysLeft;
    });
  const highRiskCount = riskItems.filter((item) => item.spoilageRisk.level === "high").length;
  const criticalRiskCount = riskItems.filter((item) => item.spoilageRisk.level === "critical").length;
  const priorityNames = riskItems
    .filter((item) => item.spoilageRisk.level === "critical" || item.spoilageRisk.level === "high")
    .slice(0, 3)
    .map((item) => item.item.name);
  const title = criticalRiskCount > 0
    ? `부패 위험 매우 높음 ${criticalRiskCount}개`
    : highRiskCount > 0
      ? `부패 위험 높은 재료 ${highRiskCount}개`
      : weather.riskLevel === "high"
        ? "오늘 날씨상 보관 주의"
        : "부패 위험 안정";
  const body = priorityNames.length > 0
    ? `${priorityNames.join(", ")} 상태를 먼저 확인하세요.`
    : weather.recommendation;

  return {
    generatedAt: toRfc3339(generatedAt),
    weather,
    summary: {
      totalItemsCount: riskItems.length,
      highRiskCount,
      criticalRiskCount,
      weatherRiskLevel: weather.riskLevel,
      title,
      body,
    },
    items: riskItems,
  };
}

function buildSpoilageRiskItem(
  item: InventoryItemDto,
  weather: SpoilageWeatherContextDto,
): InventorySpoilageRiskItemDto {
  const baseRisk = computeSpoilageRisk({
    name: item.name,
    location: item.location,
    expiresAt: item.expiresAt,
  });
  const spoilageRisk = computeSpoilageRisk({
    name: item.name,
    location: item.location,
    expiresAt: item.expiresAt,
    weather,
  });
  const weatherImpact = getWeatherSpoilageImpact({
    daysLeft: baseRisk.daysLeft,
    location: item.location,
    name: item.name,
    weather,
  });

  return {
    item,
    spoilageRisk,
    weatherImpact: {
      ...weatherImpact,
      scoreDelta: Number(Math.max(0, spoilageRisk.score - baseRisk.score).toFixed(2)),
    },
  };
}

function buildSpoilageRiskPushPayload(report: InventorySpoilageRiskReportDto): PushPayload | null {
  if (report.summary.criticalRiskCount + report.summary.highRiskCount === 0) {
    return null;
  }

  return {
    title: `잔반제로 - ${report.summary.title}`,
    body: report.summary.body,
    icon: "/icon-192x192.png",
    badge: "/icon-96x96.png",
    tag: "spoilage-risk",
    url: "/inventory",
  };
}

async function getHouseholdsWithActivePushSubscriptions(): Promise<string[]> {
  const households = await prisma.household.findMany({
    where: { pushSubscriptions: { some: { active: true } } },
    select: { id: true },
  });
  return households.map((household) => household.id);
}

function buildAlertSignature(householdId: string, report: InventorySpoilageRiskReportDto): string {
  const day = report.generatedAt.slice(0, 10);
  const riskyItemIds = report.items
    .filter((item) => item.spoilageRisk.level === "critical" || item.spoilageRisk.level === "high")
    .slice(0, 8)
    .map((item) => item.item.id)
    .join(",");
  return `${householdId}:${day}:${report.weather.riskLevel}:${riskyItemIds}`;
}
