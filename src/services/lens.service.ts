import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";
import type {
  LensAnalyzeMetadataDto,
  LensAnalyzeResponseDto,
  LensAnalyzeTextRequestDto,
  LensCandidateDto,
  StorageLocation,
} from "../domain/dto";
import { formatQuantityLabel, getDefaultQuantityUnit, parseQuantityFromText } from "../lib/quantity";
import { getRelativeDateString, isIsoLocalDateString, parseLocalDate } from "../lib/date";
import { getString, isRecord, parseJsonObject } from "../lib/json";
import { throwProblem } from "../lib/problem";
import { computeSpoilageRisk } from "../lib/spoilage-risk";
import { ensureHousehold } from "./household.service";
import { createOpenAIJsonCompletion, parseOpenAIJsonObject } from "./openai.service";

const maxImageBytes = 10 * 1024 * 1024;
const maxImagePixels = 24_000_000;
const maxImageSide = 8192;
const acceptedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const koreanCountWords: Array<[RegExp, string]> = [
  [/반\s*(개|팩|송이|장|알|모|봉|병|캔)/g, "1/2$1"],
  [/한\s*(개|팩|송이|장|알|모|봉|병|캔)/g, "1$1"],
  [/두\s*(개|팩|송이|장|알|모|봉|병|캔)/g, "2$1"],
  [/세\s*(개|팩|송이|장|알|모|봉|병|캔)/g, "3$1"],
];

const quantityPattern = /(\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\.\d+)\s*(g|kg|개|팩|송이|장|알|모|봉|병|캔)/gi;
const relativeDayPattern = /(D\s*-\s*)?(\d+)\s*(일\s*(뒤|후)?|days?|d)/i;
const isoDatePattern = /\b\d{4}-\d{2}-\d{2}\b/;

export const lensService = {
  async analyzeText(
    householdId: string,
    input: LensAnalyzeTextRequestDto,
  ): Promise<LensAnalyzeResponseDto> {
    await ensureHousehold(householdId);
    const baseDate = input.baseDate ? parseLocalDate(input.baseDate) : new Date();
    if (!baseDate) {
      throwProblem({ status: 422, title: "Validation error", detail: "baseDate must be YYYY-MM-DD" });
    }

    const startedAt = Date.now();
    const aiResult = await analyzeTextWithOpenAI(input.text, baseDate);
    const localCandidates = aiResult ? [] : parseLensNaturalTextMany(input.text, baseDate);
    const candidates = aiResult?.candidates.length
      ? aiResult.candidates
      : localCandidates.length > 0
        ? localCandidates
        : [buildFallbackCandidate(input.text, baseDate)];
    const providerName = aiResult ? "openai-text" : "local-rule-parser";
    const response: LensAnalyzeResponseDto = {
      analysisId: crypto.randomUUID(),
      status: candidates.some((candidate) => candidate.needsReview) ? "needs_review" : "completed",
      source: "natural_text",
      candidates,
      rawText: input.text,
      provider: {
        name: providerName,
        model: aiResult?.model ?? "server-rule-parser-v2",
        latencyMs: aiResult?.latencyMs ?? Date.now() - startedAt,
      },
    };

    const analysis = await prisma.lensAnalysis.create({
      data: {
        id: response.analysisId,
        householdId,
        status: response.status,
        source: response.source,
        rawText: input.text,
        result: toInputJsonObject(response),
        providerName,
      },
    });

    return {
      ...response,
      analysisId: analysis.id,
    };
  },

  async analyzeImage(
    householdId: string,
    image: File,
    metadataRaw: string | Record<string, unknown> | undefined,
  ): Promise<LensAnalyzeResponseDto> {
    await ensureHousehold(householdId);
    await validateImageFile(image);
    const metadata = parseMetadata(metadataRaw);
    const source = metadata?.source ?? "upload";
    const maxCandidates = Math.min(Math.max(metadata?.maxCandidates ?? 3, 1), 10);

    const aiResult = await analyzeImageWithOpenAI(image, maxCandidates, metadata?.confidenceThreshold);
    const allowMockFallback = process.env.LENS_IMAGE_ALLOW_MOCK_FALLBACK === "true";
    if (!aiResult && !allowMockFallback) {
      throwProblem({
        status: 503,
        title: "AI provider unavailable",
        detail: "OpenAI image analyzer is not configured or returned no usable result",
      });
    }
    const candidates = aiResult?.candidates ?? buildMockImageCandidates(maxCandidates);
    const providerName = aiResult ? "openai-vision" : "safe-mock-image-analyzer";
    const model = aiResult?.model ?? "scaffold-v1";
    const needsReview = candidates.some((c) => c.needsReview);
    const response: LensAnalyzeResponseDto = {
      analysisId: crypto.randomUUID(),
      status: needsReview ? "needs_review" : "completed",
      source,
      candidates,
      imageQuality: {
        score: aiResult?.imageQualityScore ?? 0.82,
        warnings: aiResult?.imageQualityWarnings ?? [],
      },
      provider: {
        name: providerName,
        model,
        latencyMs: aiResult?.latencyMs,
      },
    };

    const analysis = await prisma.lensAnalysis.create({
      data: {
        id: response.analysisId,
        householdId,
        status: response.status,
        source: response.source,
        imageMime: image.type,
        imageSize: image.size,
        result: toInputJsonObject(response),
        providerName,
      },
    });

    return {
      ...response,
      analysisId: analysis.id,
    };
  },

  async getAnalysis(householdId: string, analysisId: string) {
    const analysis = await prisma.lensAnalysis.findFirst({
      where: { id: analysisId, householdId },
    });

    if (!analysis) {
      throwProblem({ status: 404, title: "Not found", detail: "Lens analysis not found" });
    }

    const result = parseLensAnalyzeResponse(analysis.result);
    if (result) {
      return result;
    }

    return {
      analysisId: analysis.id,
      status: analysis.status === "failed" ? "failed" as const : "processing" as const,
      progress: analysis.status === "failed" ? 100 : 50,
    };
  },
};

function parseLensNaturalTextMany(rawText: string, baseDate: Date): LensCandidateDto[] {
  return splitNaturalTextSegments(rawText)
    .map((segment) => parseLensNaturalText(segment, baseDate, rawText))
    .filter((candidate): candidate is LensCandidateDto => candidate !== null)
    .filter((candidate, index, candidates) => (
      candidates.findIndex((other) => other.normalizedName === candidate.normalizedName) === index
    ))
    .slice(0, 20);
}

function splitNaturalTextSegments(rawText: string): string[] {
  const normalized = normalizeKoreanCountWords(rawText)
    .replace(/\r\n/g, "\n")
    .replace(/[，、;]/g, ",")
    .replace(/\s+(그리고|및|하고)\s+/g, ",")
    .replace(/(\S)랑\s+/g, "$1,");
  const direct = normalized
    .split(/[\n,]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (direct.length > 1) {
    return direct;
  }

  return splitByExpiryBoundaries(normalized);
}

function splitByExpiryBoundaries(text: string): string[] {
  const segments: string[] = [];
  let start = 0;
  const pattern = /(?:\d{4}-\d{2}-\d{2}|(?:D\s*-\s*)?\d+\s*(?:일\s*(?:뒤|후)?|days?|d))(?:\s+|$)/gi;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    const segment = text.slice(start, end).trim();
    if (segment) {
      segments.push(segment);
    }
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) {
    segments.push(tail);
  }
  return segments.length > 0 ? segments : [text.trim()].filter(Boolean);
}

function parseLensNaturalText(rawText: string, baseDate: Date, originalText = rawText): LensCandidateDto | null {
  const text = normalizeKoreanCountWords(rawText.trim());
  if (!text) {
    return null;
  }

  const location = parseStorageLocation(text);
  const name = parseIngredientName(text);
  const parsedQuantity = parseQuantityFromText(text, getDefaultQuantityUnit(name || text, "개"));
  const expiresAt = parseExpiresAt(text, baseDate);
  const needsReview = !name;

  return withSpoilageRisk({
    id: `c_${crypto.randomUUID()}`,
    name: name || text,
    quantity: formatQuantityLabel(parsedQuantity.amount, parsedQuantity.unit),
    location,
    expiresAt,
    confidence: needsReview ? 0.62 : 0.9,
    sourceText: originalText === rawText ? rawText : text,
    normalizedName: (name || text).replace(/\s+/g, "").toLowerCase(),
    needsReview: needsReview || undefined,
    reviewReasons: needsReview ? ["ambiguous_name"] : undefined,
  }, { baseDate });
}

function normalizeKoreanCountWords(text: string): string {
  return koreanCountWords.reduce(
    (normalized, [pattern, replacement]) => normalized.replace(pattern, replacement),
    text,
  );
}

function parseStorageLocation(text: string): StorageLocation {
  if (text.includes("냉동")) {
    return "냉동";
  }
  if (text.includes("실온")) {
    return "실온";
  }
  return "냉장";
}

function parseIngredientName(text: string): string {
  return text
    .replace(quantityPattern, " ")
    .replace(relativeDayPattern, " ")
    .replace(isoDatePattern, " ")
    .replace(/냉장|냉동|실온|보관|까지|소비기한|유통기한|있어|있음|남음|샀어|구매|먹어야|써야/gi, " ")
    .replace(/[,.，。]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseExpiresAt(text: string, baseDate: Date): string {
  const isoDate = text.match(isoDatePattern)?.[0];
  if (isIsoLocalDateString(isoDate)) {
    return isoDate;
  }

  const relativeDay = text.match(relativeDayPattern);
  const daysOffset = relativeDay ? Number(relativeDay[2]) : 3;

  return getRelativeDateString(Number.isFinite(daysOffset) ? daysOffset : 3, baseDate);
}

function buildFallbackCandidate(sourceText: string, baseDate: Date): LensCandidateDto {
  return withSpoilageRisk({
    id: `c_${crypto.randomUUID()}`,
    name: sourceText.trim() || "식재료",
    quantity: "1개",
    location: "냉장",
    expiresAt: getRelativeDateString(3, baseDate),
    confidence: 0.5,
    sourceText,
    needsReview: true,
    reviewReasons: ["ambiguous_name", "missing_quantity", "missing_expiry"],
  }, { baseDate });
}

function buildMockImageCandidates(maxCandidates: number): LensCandidateDto[] {
  const candidates: LensCandidateDto[] = [
    withSpoilageRisk({
      id: `c_${crypto.randomUUID()}`,
      name: "방울토마토",
      quantity: "1팩",
      location: "냉장",
      expiresAt: getRelativeDateString(5),
      confidence: 0.86,
      needsReview: true,
      reviewReasons: ["duplicate_possible"],
    }),
    withSpoilageRisk({
      id: `c_${crypto.randomUUID()}`,
      name: "연어 필렛",
      quantity: "200g",
      location: "냉장",
      expiresAt: getRelativeDateString(2),
      confidence: 0.78,
      needsReview: true,
      reviewReasons: ["low_confidence"],
    }),
    withSpoilageRisk({
      id: `c_${crypto.randomUUID()}`,
      name: "브로콜리",
      quantity: "1송이",
      location: "냉장",
      expiresAt: getRelativeDateString(4),
      confidence: 0.88,
    }),
  ];

  return candidates.slice(0, maxCandidates);
}

async function validateImageFile(image: File): Promise<void> {
  if (image.size > maxImageBytes) {
    throwProblem({ status: 413, title: "Payload too large", detail: "Image must be 10 MB or smaller" });
  }
  if (!acceptedMimeTypes.has(image.type)) {
    throwProblem({ status: 415, title: "Unsupported media type", detail: "Unsupported image MIME type" });
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!matchesMagicBytes(bytes.slice(0, 16))) {
    throwProblem({ status: 415, title: "Unsupported media type", detail: "Image magic bytes do not match an accepted format" });
  }
  const dimensions = getImageDimensions(bytes);
  if (dimensions && exceedsDimensionLimit(dimensions)) {
    throwProblem({
      status: 413,
      title: "Payload too large",
      detail: "Image dimensions exceed 24 megapixels or 8192 px per side",
    });
  }
}

function matchesMagicBytes(bytes: Uint8Array): boolean {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isWebp =
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  const isHeif =
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 &&
    ((bytes[8] === 0x68 && bytes[9] === 0x65 && bytes[10] === 0x69) ||
      (bytes[8] === 0x6d && bytes[9] === 0x69 && bytes[10] === 0x66));

  return isJpeg || isPng || isWebp || isHeif;
}

function getImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  return getPngDimensions(bytes) ?? getJpegDimensions(bytes) ?? getWebpDimensions(bytes) ?? getHeifDimensions(bytes);
}

function exceedsDimensionLimit(dimensions: { width: number; height: number }): boolean {
  return dimensions.width > maxImageSide ||
    dimensions.height > maxImageSide ||
    dimensions.width * dimensions.height > maxImagePixels;
}

function getPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !isPngSignature(bytes)) {
    return null;
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function isPngSignature(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function getJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const blockLength = readUint16BE(bytes, offset + 2);
    if (blockLength < 2) {
      return null;
    }
    const isStartOfFrame = marker !== undefined &&
      ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf));
    if (isStartOfFrame && offset + 8 < bytes.length) {
      const height = readUint16BE(bytes, offset + 5);
      const width = readUint16BE(bytes, offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + blockLength;
  }

  return null;
}

function getWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30 || !matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WEBP")) {
    return null;
  }
  if (matchesAscii(bytes, 12, "VP8X")) {
    const width = 1 + readUint24LE(bytes, 24);
    const height = 1 + readUint24LE(bytes, 27);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

function getHeifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  for (let offset = 0; offset + 20 < bytes.length; offset += 1) {
    if (matchesAscii(bytes, offset, "ispe")) {
      const width = readUint32BE(bytes, offset + 8);
      const height = readUint32BE(bytes, offset + 12);
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  return null;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) + (bytes[offset + 1] ?? 0);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8) + ((bytes[offset + 2] ?? 0) << 16);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 16_777_216) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0);
}

function matchesAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  return Array.from(value).every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function parseMetadata(metadataRaw: string | Record<string, unknown> | undefined): LensAnalyzeMetadataDto | null {
  if (!metadataRaw) {
    return null;
  }

  const parsed = typeof metadataRaw === "string" ? parseJsonObject(metadataRaw) : metadataRaw;
  if (!parsed || !isRecord(parsed)) {
    throwProblem({ status: 400, title: "Malformed JSON", detail: "metadata must be a JSON object string" });
  }

  const source = getString(parsed.source);
  const timezone = getString(parsed.timezone) ?? "Asia/Seoul";

  return {
    source: source === "camera" || source === "upload" || source === "simulator" ? source : "upload",
    timezone,
    clientCapturedAt: getString(parsed.clientCapturedAt),
    languageHints: Array.isArray(parsed.languageHints)
      ? parsed.languageHints.filter((item): item is string => typeof item === "string")
      : undefined,
    maxCandidates: typeof parsed.maxCandidates === "number" ? parsed.maxCandidates : undefined,
    confidenceThreshold: typeof parsed.confidenceThreshold === "number" ? parsed.confidenceThreshold : undefined,
  };
}

function parseLensAnalyzeResponse(value: unknown): LensAnalyzeResponseDto | null {
  if (!isRecord(value)) {
    return null;
  }

  const analysisId = getString(value.analysisId);
  const status = value.status === "completed" || value.status === "needs_review" ? value.status : undefined;
  const source =
    value.source === "camera" || value.source === "upload" || value.source === "simulator" || value.source === "natural_text"
      ? value.source
      : undefined;

  if (!analysisId || !status || !source || !Array.isArray(value.candidates)) {
    return null;
  }

  return {
    analysisId,
    status,
    source,
    candidates: value.candidates.flatMap(parseCandidate),
    rawText: getString(value.rawText),
    imageQuality: parseImageQuality(value.imageQuality),
    provider: parseProvider(value.provider),
  };
}

function parseImageQuality(value: unknown): LensAnalyzeResponseDto["imageQuality"] | undefined {
  if (!isRecord(value) || typeof value.score !== "number") {
    return undefined;
  }
  return {
    score: value.score,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is "blur" | "glare" | "too_dark" | "too_far" | "rotated" => (
        warning === "blur" ||
        warning === "glare" ||
        warning === "too_dark" ||
        warning === "too_far" ||
        warning === "rotated"
      ))
      : [],
  };
}

function parseProvider(value: unknown): LensAnalyzeResponseDto["provider"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const name = getString(value.name);
  if (!name) {
    return undefined;
  }
  return {
    name,
    model: getString(value.model),
    latencyMs: typeof value.latencyMs === "number" ? value.latencyMs : undefined,
  };
}

function parseCandidate(value: unknown): LensCandidateDto[] {
  if (!isRecord(value)) {
    return [];
  }
  const id = getString(value.id);
  const name = getString(value.name);
  const quantity = getString(value.quantity);
  const location = value.location === "냉동" || value.location === "실온" ? value.location : "냉장";
  const expiresAt = getString(value.expiresAt);
  if (!id || !name || !quantity || !expiresAt) {
    return [];
  }

  const candidate: LensCandidateDto = {
    id,
    name,
    quantity,
    location,
    expiresAt,
    confidence: typeof value.confidence === "number" ? value.confidence : undefined,
    sourceText: getString(value.sourceText),
    normalizedName: getString(value.normalizedName),
    needsReview: typeof value.needsReview === "boolean" ? value.needsReview : undefined,
    reviewReasons: Array.isArray(value.reviewReasons)
      ? value.reviewReasons.filter(isReviewReason)
      : undefined,
    boundingBox: parseBoundingBox(value.boundingBox),
    spoilageRisk: parseSpoilageRisk(value.spoilageRisk),
  };

  return [candidate.spoilageRisk ? candidate : withSpoilageRisk(candidate)];
}

function isReviewReason(value: unknown): value is NonNullable<LensCandidateDto["reviewReasons"]>[number] {
  return value === "low_confidence" ||
    value === "missing_quantity" ||
    value === "missing_expiry" ||
    value === "ambiguous_name" ||
    value === "duplicate_possible";
}

function parseBoundingBox(value: unknown): LensCandidateDto["boundingBox"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { x, y, width, height } = value;
  return typeof x === "number" && typeof y === "number" && typeof width === "number" && typeof height === "number"
    ? { x, y, width, height }
    : undefined;
}

function parseSpoilageRisk(value: unknown): LensCandidateDto["spoilageRisk"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const level = value.level === "low" || value.level === "medium" || value.level === "high" || value.level === "critical"
    ? value.level
    : undefined;
  if (!level || typeof value.score !== "number" || typeof value.daysLeft !== "number") {
    return undefined;
  }
  return {
    level,
    score: value.score,
    daysLeft: value.daysLeft,
    reasons: Array.isArray(value.reasons)
      ? value.reasons.filter(isSpoilageRiskReason)
      : [],
    recommendation: getString(value.recommendation) ?? "",
  };
}

function isSpoilageRiskReason(
  value: unknown,
): value is NonNullable<LensCandidateDto["spoilageRisk"]>["reasons"][number] {
  return value === "expires_soon" ||
    value === "expired" ||
    value === "room_temp_sensitive" ||
    value === "short_fridge_life" ||
    value === "freezer_safe" ||
    value === "low_confidence" ||
    value === "image_quality_warning";
}

function withSpoilageRisk(
  candidate: LensCandidateDto,
  options: { baseDate?: Date; imageQualityWarnings?: string[] } = {},
): LensCandidateDto {
  return {
    ...candidate,
    spoilageRisk: computeSpoilageRisk({
      name: candidate.name,
      location: candidate.location,
      expiresAt: candidate.expiresAt,
      confidence: candidate.confidence,
      imageQualityWarnings: options.imageQualityWarnings,
      baseDate: options.baseDate,
    }),
  };
}

async function analyzeTextWithOpenAI(
  rawText: string,
  baseDate: Date,
): Promise<{ candidates: LensCandidateDto[]; model: string; latencyMs: number } | null> {
  const baseDateLabel = getRelativeDateString(0, baseDate);
  try {
    const completion = await createOpenAIJsonCompletion({
      maxTokens: 1400,
      messages: [
        {
          role: "system",
          content:
            "You parse Korean natural-language grocery/fridge text into inventory candidates. Split every ingredient. Do not invent items. Return only JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            baseDate: baseDateLabel,
            text: rawText,
            outputShape: {
              items: [{
                name: "Korean canonical ingredient name",
                quantity: "quantity label such as 1개, 200g, 1/2모",
                location: "냉장|냉동|실온",
                expiresAt: "YYYY-MM-DD",
                confidence: "0..1",
                sourceText: "source phrase",
                reviewReasons: ["low_confidence|missing_quantity|missing_expiry|ambiguous_name"],
              }],
            },
          }),
        },
      ],
    });
    if (!completion) {
      return null;
    }

    const parsed = parseOpenAIJsonObject(completion.content);
    const items = getItemsArray(parsed);
    if (!items.length) {
      return null;
    }

    const candidates = items
      .map((item) => buildCandidateFromAIRecord(item, baseDate, rawText))
      .filter((candidate): candidate is LensCandidateDto => candidate !== null)
      .slice(0, 20);

    return candidates.length > 0
      ? { candidates, model: completion.model, latencyMs: completion.latencyMs }
      : null;
  } catch {
    return null;
  }
}

type ImageAnalysisResult = {
  candidates: LensCandidateDto[];
  model: string;
  latencyMs: number;
  imageQualityScore: number;
  imageQualityWarnings: Array<"blur" | "glare" | "too_dark" | "too_far" | "rotated">;
};

async function analyzeImageWithOpenAI(
  image: File,
  maxCandidates: number,
  confidenceThreshold: number | undefined,
): Promise<ImageAnalysisResult | null> {
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";

  try {
    const bytes = new Uint8Array(await image.arrayBuffer());
    const base64 = Buffer.from(bytes).toString("base64");
    const dataUri = `data:${image.type};base64,${base64}`;

    const completion = await createOpenAIJsonCompletion({
      model,
      maxTokens: 1200,
      messages: [
        {
          role: "system",
          content:
            "You analyze food/receipt/fridge images for a Korean household inventory app. Return JSON only. If uncertain, mark review reasons.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                maxCandidates,
                confidenceThreshold: confidenceThreshold ?? 0.55,
                outputShape: {
                  imageQuality: {
                    score: "0..1",
                    warnings: ["blur", "glare", "too_dark", "too_far", "rotated"],
                  },
                  items: [{
                    name: "Korean canonical food/ingredient name",
                    quantity: "1팩, 200g, 3개, etc.",
                    location: "냉장|냉동|실온",
                    expiresInDays: "typical remaining shelf-life integer from today",
                    confidence: "0..1",
                    reviewReasons: ["low_confidence|missing_quantity|ambiguous_name"],
                    boundingBox: { x: "0..1", y: "0..1", width: "0..1", height: "0..1" },
                  }],
                },
              }),
            },
            {
              type: "image_url",
              image_url: { url: dataUri, detail: "low" },
            },
          ],
        },
      ],
    });
    if (!completion) return null;

    const parsed = parseOpenAIJsonObject(completion.content);
    const items = getItemsArray(parsed);
    if (!items.length) return null;

    const threshold = Math.max(0, Math.min(1, confidenceThreshold ?? 0.55));
    const imageQuality = isRecord(parsed?.imageQuality) ? parsed.imageQuality : undefined;
    const imageQualityWarnings = Array.isArray(imageQuality?.warnings)
      ? imageQuality.warnings.filter((warning): warning is "blur" | "glare" | "too_dark" | "too_far" | "rotated" => (
        warning === "blur" ||
        warning === "glare" ||
        warning === "too_dark" ||
        warning === "too_far" ||
        warning === "rotated"
      ))
      : [];
    const candidates = items
      .slice(0, maxCandidates)
      .map((item) => buildCandidateFromAIRecord(item, new Date(), undefined, threshold, imageQualityWarnings))
      .filter((candidate): candidate is LensCandidateDto => candidate !== null);
    if (candidates.length === 0) {
      return null;
    }

    return {
      candidates,
      model: completion.model,
      latencyMs: completion.latencyMs,
      imageQualityScore: typeof imageQuality?.score === "number" ? imageQuality.score : 0.88,
      imageQualityWarnings,
    };
  } catch {
    return null;
  }
}

function getItemsArray(parsed: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!parsed) {
    return [];
  }
  const value = parsed.items ?? parsed.candidates ?? parsed.foods ?? parsed.results;
  return Array.isArray(value)
    ? value.filter(isRecord)
    : [];
}

function buildCandidateFromAIRecord(
  record: Record<string, unknown>,
  baseDate: Date,
  fallbackSourceText: string | undefined,
  confidenceThreshold = 0.55,
  imageQualityWarnings: string[] = [],
): LensCandidateDto | null {
  const name = getString(record.name) ?? getString(record.normalizedName) ?? getString(record.ingredient);
  if (!name) {
    return null;
  }
  const confidence = typeof record.confidence === "number"
    ? Math.max(0, Math.min(1, record.confidence))
    : 0.72;
  const quantity = getString(record.quantity) ?? "1개";
  const location: StorageLocation = record.location === "냉동" || record.location === "실온" ? record.location : "냉장";
  const expiresAtInput = getString(record.expiresAt);
  const expiresAt = expiresAtInput && isIsoLocalDateString(expiresAtInput)
    ? expiresAtInput
    : getRelativeDateString(Number(record.expiresInDays) || 3, baseDate);
  const reviewReasons = Array.isArray(record.reviewReasons)
    ? record.reviewReasons.filter(isReviewReason)
    : [];
  if (confidence < Math.max(0.8, confidenceThreshold)) {
    reviewReasons.push("low_confidence");
  }
  if (!getString(record.quantity)) {
    reviewReasons.push("missing_quantity");
  }

  const uniqueReasons = Array.from(new Set(reviewReasons));
  return withSpoilageRisk({
    id: `c_${crypto.randomUUID()}`,
    name,
    quantity,
    location,
    expiresAt,
    confidence,
    sourceText: getString(record.sourceText) ?? fallbackSourceText,
    normalizedName: name.replace(/\s+/g, "").toLowerCase(),
    needsReview: uniqueReasons.length > 0 || undefined,
    reviewReasons: uniqueReasons.length > 0 ? uniqueReasons : undefined,
    boundingBox: parseBoundingBox(record.boundingBox),
  }, { baseDate, imageQualityWarnings });
}

function toInputJsonObject(value: LensAnalyzeResponseDto): Prisma.InputJsonObject {
  const serialized: unknown = JSON.parse(JSON.stringify(value));
  if (!isRecord(serialized)) {
    throwProblem({ status: 500, title: "Internal server error", detail: "Failed to serialize lens result" });
  }
  return serialized as Prisma.InputJsonObject;
}
