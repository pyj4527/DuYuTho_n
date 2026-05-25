import { describe, expect, it } from "bun:test";
import type { InventoryItemDto } from "../domain/dto";
import { getRelativeDateString } from "../lib/date";
import { buildSpoilageWeatherContext } from "./weather.service";
import { buildInventorySpoilageRiskReport } from "./spoilage-risk.service";

const tofu: InventoryItemDto = {
  id: "tofu",
  name: "두부",
  quantity: "1모",
  location: "실온",
  expiresAt: getRelativeDateString(1),
};

const frozenMushroom: InventoryItemDto = {
  id: "mushroom",
  name: "버섯",
  quantity: "100g",
  location: "냉동",
  expiresAt: getRelativeDateString(20),
};

describe("weather-adjusted spoilage risk", () => {
  it("raises room-temperature sensitive food risk on hot and humid days", () => {
    const weather = buildSpoilageWeatherContext({
      locationLabel: "서울",
      observedAt: new Date("2026-07-10T09:00:00.000Z"),
      relativeHumidity: 82,
      source: "open_meteo",
      temperatureC: 31,
    });
    const report = buildInventorySpoilageRiskReport([tofu, frozenMushroom], weather, new Date("2026-05-25T00:00:00.000Z"));
    const tofuRisk = report.items.find((item) => item.item.id === "tofu");

    expect(report.summary.highRiskCount + report.summary.criticalRiskCount).toBeGreaterThan(0);
    expect(tofuRisk?.spoilageRisk.reasons).toContain("hot_weather");
    expect(tofuRisk?.spoilageRisk.reasons).toContain("humid_weather");
    expect(tofuRisk?.weatherImpact.adjustedDaysLeft).toBeLessThan(tofuRisk?.spoilageRisk.daysLeft ?? 99);
  });
});
