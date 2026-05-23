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
import { ensureHousehold } from "./household.service";

let openaiClient: Awaited<ReturnType<typeof createOpenAIClient>> | undefined;

async function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  try {
    const { default: OpenAI } = await import("openai");
    return new OpenAI({ apiKey });
  } catch {
    return undefined;
  }
}

async function getOpenAIClient() {
  if (openaiClient === undefined) {
    openaiClient = await createOpenAIClient();
  }
  return openaiClient;
}

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

    const parsed = parseLensNaturalText(input.text, baseDate);
    const candidates = parsed ? [parsed] : [buildFallbackCandidate(input.text, baseDate)];
    const response: LensAnalyzeResponseDto = {
      analysisId: crypto.randomUUID(),
      status: candidates.some((candidate) => candidate.needsReview) ? "needs_review" : "completed",
      source: "natural_text",
      candidates,
      rawText: input.text,
      provider: {
        name: "local-rule-parser",
        model: "frontend-compatible-v1",
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
        providerName: "local-rule-parser",
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
    metadataRaw: string | undefined,
  ): Promise<LensAnalyzeResponseDto> {
    await ensureHousehold(householdId);
    await validateImageFile(image);
    const metadata = parseMetadata(metadataRaw);
    const source = metadata?.source ?? "upload";
    const maxCandidates = Math.min(Math.max(metadata?.maxCandidates ?? 3, 1), 10);

    const aiCandidates = await analyzeImageWithOpenAI(image, maxCandidates);
    const candidates = aiCandidates ?? buildMockImageCandidates(maxCandidates);
    const providerName = aiCandidates ? "openai-vision" : "safe-mock-image-analyzer";
    const model = aiCandidates ? (process.env.OPENAI_VISION_MODEL || "gpt-4o-mini") : "scaffold-v1";
    const needsReview = candidates.some((c) => c.needsReview);
    const response: LensAnalyzeResponseDto = {
      analysisId: crypto.randomUUID(),
      status: needsReview ? "needs_review" : "completed",
      source,
      candidates,
      imageQuality: {
        score: aiCandidates ? 0.88 : 0.82,
        warnings: [],
      },
      provider: {
        name: providerName,
        model,
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

function parseLensNaturalText(rawText: string, baseDate: Date): LensCandidateDto | null {
  const text = normalizeKoreanCountWords(rawText.trim());
  if (!text) {
    return null;
  }

  const location = parseStorageLocation(text);
  const name = parseIngredientName(text);
  const parsedQuantity = parseQuantityFromText(text, getDefaultQuantityUnit(name || text, "개"));
  const expiresAt = parseExpiresAt(text, baseDate);
  const needsReview = !name;

  return {
    id: `c_${crypto.randomUUID()}`,
    name: name || text,
    quantity: formatQuantityLabel(parsedQuantity.amount, parsedQuantity.unit),
    location,
    expiresAt,
    confidence: needsReview ? 0.62 : 0.9,
    sourceText: rawText,
    normalizedName: (name || text).replace(/\s+/g, "").toLowerCase(),
    needsReview: needsReview || undefined,
    reviewReasons: needsReview ? ["ambiguous_name"] : undefined,
  };
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
    .replace(/냉장|냉동|실온|보관|까지|소비기한|유통기한/gi, " ")
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
  return {
    id: `c_${crypto.randomUUID()}`,
    name: sourceText.trim() || "식재료",
    quantity: "1개",
    location: "냉장",
    expiresAt: getRelativeDateString(3, baseDate),
    confidence: 0.5,
    sourceText,
    needsReview: true,
    reviewReasons: ["ambiguous_name", "missing_quantity", "missing_expiry"],
  };
}

function buildMockImageCandidates(maxCandidates: number): LensCandidateDto[] {
  const candidates: LensCandidateDto[] = [
    {
      id: `c_${crypto.randomUUID()}`,
      name: "방울토마토",
      quantity: "1팩",
      location: "냉장",
      expiresAt: getRelativeDateString(5),
      confidence: 0.86,
      needsReview: true,
      reviewReasons: ["duplicate_possible"],
    },
    {
      id: `c_${crypto.randomUUID()}`,
      name: "연어 필렛",
      quantity: "200g",
      location: "냉장",
      expiresAt: getRelativeDateString(2),
      confidence: 0.78,
      needsReview: true,
      reviewReasons: ["low_confidence"],
    },
    {
      id: `c_${crypto.randomUUID()}`,
      name: "브로콜리",
      quantity: "1송이",
      location: "냉장",
      expiresAt: getRelativeDateString(4),
      confidence: 0.88,
    },
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

function parseMetadata(metadataRaw: string | undefined): LensAnalyzeMetadataDto | null {
  if (!metadataRaw) {
    return null;
  }

  const parsed = parseJsonObject(metadataRaw);
  if (!parsed) {
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

  return [{
    id,
    name,
    quantity,
    location,
    expiresAt,
    confidence: typeof value.confidence === "number" ? value.confidence : undefined,
    sourceText: getString(value.sourceText),
    normalizedName: getString(value.normalizedName),
    needsReview: typeof value.needsReview === "boolean" ? value.needsReview : undefined,
  }];
}

async function analyzeImageWithOpenAI(image: File, maxCandidates: number): Promise<LensCandidateDto[] | null> {
  const client = await getOpenAIClient();
  if (!client) return null;

  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";

  try {
    const bytes = new Uint8Array(await image.arrayBuffer());
    const base64 = Buffer.from(bytes).toString("base64");
    const dataUri = `data:${image.type};base64,${base64}`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this food image and return a JSON object with a key "items" containing up to ${maxCandidates} detected food items. Each item must have: name (Korean food name), quantity (e.g. "1팩", "200g", "3개"), location (냉장/냉동/실온), expiresInDays (integer, typical shelf life), confidence (0.0-1.0). Return ONLY valid JSON with no markdown.`,
            },
            {
              type: "image_url",
              image_url: { url: dataUri, detail: "low" },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed) ? parsed : parsed.items ?? parsed.candidates ?? parsed.foods ?? parsed.results ?? [];
    if (!Array.isArray(items)) return null;

    return items.slice(0, maxCandidates).map((item: unknown): LensCandidateDto => {
      const record = isRecord(item) ? item : {};
      const confidence = typeof record.confidence === "number" ? Math.max(0, Math.min(1, record.confidence)) : 0.75;
      const expiresInDays = Number(record.expiresInDays) || 3;
      const location: StorageLocation = record.location === "냉동" || record.location === "실온" ? record.location : "냉장";
      const needsReview = confidence < 0.8 || !record.name || !record.quantity;

      const reasons: Array<"low_confidence" | "ambiguous_name" | "missing_quantity"> = [];
      if (confidence < 0.8) reasons.push("low_confidence");
      if (!record.name) reasons.push("ambiguous_name");
      if (!record.quantity) reasons.push("missing_quantity");

      return {
        id: `c_${crypto.randomUUID()}`,
        name: String(record.name || "식재료"),
        quantity: String(record.quantity || "1개"),
        location,
        expiresAt: getRelativeDateString(expiresInDays),
        confidence,
        needsReview: needsReview || undefined,
        reviewReasons: reasons.length > 0 ? reasons : undefined,
      };
    });
  } catch {
    return null;
  }
}

function toInputJsonObject(value: LensAnalyzeResponseDto): Prisma.InputJsonObject {
  const serialized: unknown = JSON.parse(JSON.stringify(value));
  if (!isRecord(serialized)) {
    throwProblem({ status: 500, title: "Internal server error", detail: "Failed to serialize lens result" });
  }
  return serialized as Prisma.InputJsonObject;
}
