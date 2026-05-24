import type { SpoilageRiskDto, StorageLocation } from "../domain/dto";
import { calculateDaysLeft } from "./date";

type SpoilageRiskInput = {
  name: string;
  location: StorageLocation;
  expiresAt: string;
  confidence?: number;
  imageQualityWarnings?: string[];
  baseDate?: Date;
};

const sensitiveFoodPatterns = [
  /고기|소고기|돼지고기|닭|닭가슴살|연어|생선|참치|해산물|새우|조개|굴|우유|치즈|요거트|계란|달걀|두부|콩나물/i,
  /meat|beef|pork|chicken|fish|salmon|seafood|shrimp|milk|cheese|yogurt|egg|tofu/i,
];

const roomTempFriendlyPatterns = [
  /사과|감자|고구마|양파|마늘|쌀|파스타|면|통조림|캔|소스|간장|식초|오일|설탕|소금/i,
  /apple|potato|onion|garlic|rice|pasta|can|sauce|oil|salt|sugar/i,
];

export function computeSpoilageRisk(input: SpoilageRiskInput): SpoilageRiskDto {
  const daysLeft = calculateDaysLeft(input.expiresAt, input.baseDate);
  const sensitive = sensitiveFoodPatterns.some((pattern) => pattern.test(input.name));
  const roomTempFriendly = roomTempFriendlyPatterns.some((pattern) => pattern.test(input.name));
  let score = scoreFromDaysLeft(daysLeft);
  const reasons: SpoilageRiskDto["reasons"] = [];

  if (daysLeft < 0) {
    reasons.push("expired");
  } else if (daysLeft <= 2) {
    reasons.push("expires_soon");
  }

  if (input.location === "실온" && sensitive) {
    score += 0.35;
    reasons.push("room_temp_sensitive");
  }
  if (input.location === "냉장" && sensitive && daysLeft <= 4) {
    score += 0.1;
    reasons.push("short_fridge_life");
  }
  if (input.location === "냉동") {
    score -= sensitive ? 0.2 : 0.1;
    reasons.push("freezer_safe");
  }
  if (input.location === "실온" && roomTempFriendly && daysLeft > 3) {
    score -= 0.1;
  }
  if (typeof input.confidence === "number" && input.confidence < 0.65) {
    score += 0.1;
    reasons.push("low_confidence");
  }
  if ((input.imageQualityWarnings?.length ?? 0) > 0) {
    score += 0.08;
    reasons.push("image_quality_warning");
  }

  const normalizedScore = clampScore(score);
  return {
    level: levelFromScore(normalizedScore),
    score: Number(normalizedScore.toFixed(2)),
    daysLeft,
    reasons: Array.from(new Set(reasons)),
    recommendation: recommendationFromRisk(normalizedScore, daysLeft, input.location),
  };
}

function scoreFromDaysLeft(daysLeft: number): number {
  if (daysLeft < 0) return 0.95;
  if (daysLeft === 0) return 0.8;
  if (daysLeft <= 2) return 0.62;
  if (daysLeft <= 5) return 0.38;
  if (daysLeft <= 7) return 0.24;
  return 0.12;
}

function levelFromScore(score: number): SpoilageRiskDto["level"] {
  if (score >= 0.85) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

function recommendationFromRisk(score: number, daysLeft: number, location: StorageLocation): string {
  if (daysLeft < 0) return "소비기한이 지나 폐기 여부를 먼저 확인하세요.";
  if (score >= 0.85) return "오늘 바로 상태 확인 후 조리하거나 폐기하세요.";
  if (score >= 0.6) return "1-2일 안에 우선 사용하세요.";
  if (score >= 0.35) return location === "냉동" ? "냉동 보관 상태를 유지하세요." : "이번 주 안에 사용하세요.";
  return "현재 보관 위험은 낮습니다.";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}
