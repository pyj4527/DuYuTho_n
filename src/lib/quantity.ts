export type QuantityParts = {
  amount: string;
  unit: string;
};

export type QuantityReduction =
  | { kind: "updated"; quantity: string }
  | { kind: "removed" }
  | { kind: "needs_review" };

const defaultUnit = "개";

const unitByName: Array<[RegExp, string]> = [
  [/두부|묵/, "모"],
  [/상추|깻잎|배추잎|장/, "장"],
  [/버섯|브로콜리|대파|바나나/, "송이"],
  [/연어|삼겹살|고기|소고기|돼지고기|닭고기|필렛/, "g"],
  [/토마토|방울토마토|딸기|블루베리/, "팩"],
  [/우유|주스|소스|간장|식초|오일/, "병"],
];

function toDecimalString(value: string): string {
  const fraction = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!fraction) {
    return value;
  }

  const numerator = Number(fraction[1]);
  const denominator = Number(fraction[2]);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return value;
  }

  return Number.parseFloat((numerator / denominator).toFixed(2)).toString();
}

export function sanitizeQuantityAmount(value: string): string {
  const normalized = value.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const dotIndex = normalized.indexOf(".");

  if (dotIndex === -1) {
    return normalized.replace(/^0+(?=\d)/, "");
  }

  const integer = normalized.slice(0, dotIndex).replace(/^0+(?=\d)/, "");
  const decimal = normalized.slice(dotIndex + 1).replace(/\./g, "").slice(0, 2);

  return `${integer || "0"}.${decimal}`;
}

function normalizeAmountForSave(amount: string): string {
  const sanitized = sanitizeQuantityAmount(amount);

  if (!sanitized || sanitized === "0.") {
    return "1";
  }
  if (sanitized.endsWith(".")) {
    return sanitized.slice(0, -1) || "1";
  }
  return sanitized;
}

export function getDefaultQuantityUnit(name: string, fallback = defaultUnit): string {
  const trimmedName = name.trim();
  const match = unitByName.find(([pattern]) => pattern.test(trimmedName));

  return match?.[1] ?? fallback;
}

export function parseQuantityLabel(
  quantity: string,
  fallbackUnit = defaultUnit,
): QuantityParts {
  const trimmed = quantity.trim();
  const match = trimmed.match(/^(\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\.\d+)\s*(\D.*)?$/);

  if (!match) {
    return {
      amount: "1",
      unit: fallbackUnit,
    };
  }

  return {
    amount: normalizeAmountForSave(toDecimalString(match[1] ?? "1")),
    unit: match[2]?.trim() || fallbackUnit,
  };
}

export function formatQuantityLabel(amount: string, unit: string): string {
  const sanitizedAmount = normalizeAmountForSave(amount);
  return `${sanitizedAmount}${unit || defaultUnit}`;
}

export function parseQuantityFromText(text: string, fallbackUnit = defaultUnit): QuantityParts {
  const match = text.match(
    /(\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\.\d+)\s*(g|kg|개|팩|송이|장|알|모|봉|병|캔)/i,
  );

  if (!match) {
    return {
      amount: "1",
      unit: fallbackUnit,
    };
  }

  return {
    amount: normalizeAmountForSave(toDecimalString(match[1] ?? "1")),
    unit: match[2] ?? fallbackUnit,
  };
}

export function parseQuantityNumberAndUnit(label: string): {
  amount: number | null;
  unit: string | null;
} {
  const parsed = parseQuantityLabel(label);
  const amount = Number(parsed.amount);

  return {
    amount: Number.isFinite(amount) ? amount : null,
    unit: parsed.unit || null,
  };
}

export function reduceQuantityLabel(quantity: string): QuantityReduction {
  const trimmed = quantity.trim();
  const fractionalCount = trimmed.match(/^\d+\s*\/\s*\d+\s*(개|팩|송이|장|알|모)$/);
  if (fractionalCount) {
    return { kind: "removed" };
  }

  const grams = trimmed.match(/^(\d+)\s*g$/i);

  if (grams) {
    const remaining = Math.round(Number(grams[1]) * 0.65);
    return remaining >= 50 ? { kind: "updated", quantity: `${remaining}g` } : { kind: "removed" };
  }

  const count = trimmed.match(/^(\d+)\s*(개|팩|송이|장|알|모)$/);
  if (count) {
    const remaining = Number(count[1]) - 1;
    return remaining > 0
      ? { kind: "updated", quantity: `${remaining}${count[2]}` }
      : { kind: "removed" };
  }

  return trimmed ? { kind: "needs_review" } : { kind: "removed" };
}

export function reduceQuantityByExplicitAmount(current: string, used: string): QuantityReduction {
  const currentParts = parseQuantityLabel(current);
  const usedParts = parseQuantityLabel(used, currentParts.unit);
  const currentAmount = Number(currentParts.amount);
  const usedAmount = Number(usedParts.amount);

  if (
    !Number.isFinite(currentAmount) ||
    !Number.isFinite(usedAmount) ||
    usedAmount <= 0 ||
    normalizeUnit(currentParts.unit) !== normalizeUnit(usedParts.unit)
  ) {
    return { kind: "needs_review" };
  }

  const remaining = Number.parseFloat((currentAmount - usedAmount).toFixed(2));
  if (remaining <= 0) {
    return { kind: "removed" };
  }
  if (normalizeUnit(currentParts.unit) === "g" && remaining < 50) {
    return { kind: "removed" };
  }

  return { kind: "updated", quantity: `${formatAmount(remaining)}${currentParts.unit}` };
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase();
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : Number.parseFloat(amount.toFixed(2)).toString();
}
