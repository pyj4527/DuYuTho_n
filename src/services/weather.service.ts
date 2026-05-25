import type { SpoilageWeatherContextDto, WeatherSeasonDto } from "../domain/dto";
import { toRfc3339 } from "../lib/date";

type CachedWeather = {
  expiresAt: number;
  value: SpoilageWeatherContextDto;
};

type OpenMeteoCurrentResponse = {
  current?: {
    relative_humidity_2m?: number;
    temperature_2m?: number;
    time?: string;
  };
};

let cachedWeather: CachedWeather | undefined;

export const weatherService = {
  async getCurrentSpoilageWeather(now = new Date()): Promise<SpoilageWeatherContextDto> {
    const cacheTtlMs = normalizePositiveNumber(process.env.WEATHER_CACHE_TTL_MINUTES, 45) * 60_000;
    if (cachedWeather && cachedWeather.expiresAt > now.getTime()) {
      return cachedWeather.value;
    }

    const fetched = process.env.WEATHER_API_ENABLED === "false"
      ? null
      : await fetchOpenMeteoWeather(now);
    const weather = fetched ?? buildSeasonalFallbackWeather(now);
    cachedWeather = {
      expiresAt: now.getTime() + cacheTtlMs,
      value: weather,
    };
    return weather;
  },

  clearCache(): void {
    cachedWeather = undefined;
  },
};

export function buildSpoilageWeatherContext(input: {
  locationLabel: string;
  observedAt: Date;
  relativeHumidity: number;
  source: SpoilageWeatherContextDto["source"];
  temperatureC: number;
}): SpoilageWeatherContextDto {
  const season = getSeason(input.observedAt);
  const temperatureC = clampNumber(input.temperatureC, -40, 60);
  const relativeHumidity = clampNumber(input.relativeHumidity, 0, 100);
  const riskLevel = getWeatherRiskLevel(temperatureC, relativeHumidity, season);
  const freshnessWindowAdjustmentDays = riskLevel === "high" ? 2 : riskLevel === "elevated" ? 1 : 0;

  return {
    observedAt: toRfc3339(input.observedAt),
    source: input.source,
    locationLabel: input.locationLabel,
    temperatureC: Number(temperatureC.toFixed(1)),
    relativeHumidity: Math.round(relativeHumidity),
    season,
    riskLevel,
    freshnessWindowAdjustmentDays,
    recommendation: weatherRecommendation(riskLevel, temperatureC, relativeHumidity),
  };
}

export function getSeason(date: Date): WeatherSeasonDto {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

async function fetchOpenMeteoWeather(now: Date): Promise<SpoilageWeatherContextDto | null> {
  const latitude = normalizeCoordinate(process.env.WEATHER_LATITUDE, 37.5665, -90, 90);
  const longitude = normalizeCoordinate(process.env.WEATHER_LONGITUDE, 126.9780, -180, 180);
  const timezone = process.env.WEATHER_TIMEZONE?.trim() || "Asia/Seoul";
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m");
  url.searchParams.set("timezone", timezone);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    normalizePositiveNumber(process.env.WEATHER_FETCH_TIMEOUT_MS, 2500),
  );
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const body = await response.json() as OpenMeteoCurrentResponse;
    const temperatureC = body.current?.temperature_2m;
    const relativeHumidity = body.current?.relative_humidity_2m;
    if (typeof temperatureC !== "number" || typeof relativeHumidity !== "number") {
      return null;
    }

    const observedAt = body.current?.time ? new Date(body.current.time) : now;
    return buildSpoilageWeatherContext({
      locationLabel: process.env.WEATHER_LOCATION_LABEL?.trim() || "서울",
      observedAt: Number.isNaN(observedAt.getTime()) ? now : observedAt,
      relativeHumidity,
      source: "open_meteo",
      temperatureC,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSeasonalFallbackWeather(now: Date): SpoilageWeatherContextDto {
  const season = getSeason(now);
  const seasonalDefaults: Record<WeatherSeasonDto, { humidity: number; temp: number }> = {
    spring: { temp: 17, humidity: 58 },
    summer: { temp: 29, humidity: 78 },
    autumn: { temp: 19, humidity: 62 },
    winter: { temp: 2, humidity: 45 },
  };
  const fallback = seasonalDefaults[season];

  return buildSpoilageWeatherContext({
    locationLabel: process.env.WEATHER_LOCATION_LABEL?.trim() || "서울 계절 기준",
    observedAt: now,
    relativeHumidity: fallback.humidity,
    source: "seasonal_fallback",
    temperatureC: fallback.temp,
  });
}

function getWeatherRiskLevel(
  temperatureC: number,
  relativeHumidity: number,
  season: WeatherSeasonDto,
): SpoilageWeatherContextDto["riskLevel"] {
  if (temperatureC >= 30 || (temperatureC >= 27 && relativeHumidity >= 75)) return "high";
  if (temperatureC >= 24 || relativeHumidity >= 80 || season === "summer") return "elevated";
  return "normal";
}

function weatherRecommendation(
  riskLevel: SpoilageWeatherContextDto["riskLevel"],
  temperatureC: number,
  relativeHumidity: number,
): string {
  if (riskLevel === "high") {
    return `현재 ${temperatureC.toFixed(1)}도, 습도 ${Math.round(relativeHumidity)}%입니다. 실온 재료와 민감 재료를 먼저 확인하세요.`;
  }
  if (riskLevel === "elevated") {
    return `날씨 영향이 있습니다. 냉장 보관과 임박 재료 우선 사용을 권장합니다.`;
  }
  return "오늘 날씨 기준 부패 가속 위험은 낮습니다.";
}

function normalizeCoordinate(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) ? clampNumber(parsed, min, max) : fallback;
}

function normalizePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
