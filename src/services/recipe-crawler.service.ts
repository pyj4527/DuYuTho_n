import type {
  RecipeDto,
  RecipeIngredientDto,
  RecipeNutritionDto,
  RecipeStepDto,
} from "../domain/dto";
import { getString, isRecord } from "../lib/json";
import { throwProblem } from "../lib/problem";
import { createOpenAIJsonCompletion, parseOpenAIJsonObject } from "./openai.service";

export type CrawledRecipeCandidate = Omit<RecipeDto, "id" | "saved" | "createdAt" | "updatedAt"> & {
  sourceUrl: string;
  sourceSite: string;
};

type RawRecipe = {
  sourceUrl: string;
  sourceSite: string;
  name: string;
  description?: string;
  ingredients: string[];
  steps: string[];
  imageUrl?: string;
  timeMinutes?: number;
  servings?: number;
  difficulty?: "easy" | "medium" | "hard";
  tags: string[];
  nutrition?: RecipeNutritionDto;
};

const defaultAllowedHosts = ["10000recipe.com", "www.10000recipe.com"];
const maxRecipeHtmlBytes = Number(process.env.RECIPE_CRAWL_MAX_BYTES ?? 2_000_000);
const fetchTimeoutMs = Number(process.env.RECIPE_CRAWL_TIMEOUT_MS ?? 8000);

export const recipeCrawlerService = {
  async crawlAndNormalize(url: string): Promise<CrawledRecipeCandidate> {
    const normalizedUrl = validateRecipeUrl(url);
    const fetched = await fetchHtml(normalizedUrl);
    const raw = parseRecipeHtml(fetched.html, fetched.finalUrl);
    const normalized = await normalizeRecipeWithOpenAI(raw) ?? normalizeRecipeFallback(raw);

    return {
      ...normalized,
      sourceUrl: fetched.finalUrl,
      sourceSite: raw.sourceSite,
    };
  },

  async discoverRecipeUrls(query: string, maxResults: number): Promise<string[]> {
    const configured = getConfiguredRecipeUrls();
    if (configured.length > 0) {
      return configured.slice(0, maxResults);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const searchUrl = new URL("https://www.10000recipe.com/recipe/list.html");
    searchUrl.searchParams.set("q", trimmed);
    searchUrl.searchParams.set("order", "reco");
    searchUrl.searchParams.set("page", "1");

    const fetched = await fetchHtml(searchUrl);
    const urls = Array.from(fetched.html.matchAll(/href=["']\/recipe\/(\d+)["']/g))
      .map((match) => match[1])
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => `https://www.10000recipe.com/recipe/${id}`);

    return Array.from(new Set(urls)).slice(0, maxResults);
  },
};

function getConfiguredRecipeUrls(): string[] {
  return (process.env.RECIPE_CRAWL_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => validateRecipeUrl(value).toString());
}

function validateRecipeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throwProblem({ status: 422, title: "Validation error", detail: "url must be an absolute http(s) URL" });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throwProblem({ status: 422, title: "Validation error", detail: "Only http(s) recipe URLs are supported" });
  }
  assertSafeHostname(url.hostname);
  assertAllowedHostname(url.hostname);
  url.hash = "";
  return url;
}

function assertSafeHostname(hostname: string): void {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  ) {
    throwProblem({ status: 422, title: "Validation error", detail: "Private or local recipe URLs are not allowed" });
  }
}

function assertAllowedHostname(hostname: string): void {
  const allowedHosts = (process.env.RECIPE_CRAWL_ALLOWED_HOSTS ?? defaultAllowedHosts.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowedHosts.includes("*")) {
    return;
  }
  const normalized = hostname.toLowerCase();
  const allowed = allowedHosts.some((allowedHost) => (
    normalized === allowedHost || normalized.endsWith(`.${allowedHost}`)
  ));
  if (!allowed) {
    throwProblem({
      status: 422,
      title: "Validation error",
      detail: `Recipe host ${hostname} is not in RECIPE_CRAWL_ALLOWED_HOSTS`,
    });
  }
}

async function fetchHtml(url: URL): Promise<{ finalUrl: string; html: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.2",
        "user-agent": "JanbanZeroBot/1.0 recipe-import (+https://janban.example)",
      },
    });
    if (!response.ok) {
      throwProblem({
        status: 422,
        title: "Recipe crawl failed",
        detail: `Recipe source returned HTTP ${response.status}`,
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/html|json|text/i.test(contentType)) {
      throwProblem({
        status: 415,
        title: "Unsupported media type",
        detail: "Recipe source must return HTML or JSON-LD text",
      });
    }

    const finalUrl = response.url || url.toString();
    validateRecipeUrl(finalUrl);
    return {
      finalUrl,
      html: await readResponseText(response, maxRecipeHtmlBytes),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throwProblem({ status: 504, title: "Recipe crawl timeout", detail: "Recipe source did not respond in time" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throwProblem({ status: 413, title: "Payload too large", detail: "Recipe page is too large" });
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      throwProblem({ status: 413, title: "Payload too large", detail: "Recipe page is too large" });
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseRecipeHtml(html: string, sourceUrl: string): RawRecipe {
  const jsonLdRecipe = extractJsonLdRecipe(html);
  if (jsonLdRecipe) {
    return jsonLdToRawRecipe(jsonLdRecipe, sourceUrl);
  }

  const raw = htmlToRawRecipe(html, sourceUrl);
  if (raw.ingredients.length === 0 || raw.steps.length === 0) {
    throwProblem({
      status: 422,
      title: "Recipe parse failed",
      detail: "Recipe page did not expose parsable ingredients and steps",
    });
  }
  return raw;
}

function extractJsonLdRecipe(html: string): Record<string, unknown> | null {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    const rawScript = decodeHtmlEntities(match[1] ?? "").trim();
    if (!rawScript) continue;
    try {
      const parsed: unknown = JSON.parse(rawScript);
      const recipe = findRecipeObject(parsed);
      if (recipe) return recipe;
    } catch {
      continue;
    }
  }
  return null;
}

function findRecipeObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const recipe = findRecipeObject(item);
      if (recipe) return recipe;
    }
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (isRecipeType(value["@type"])) {
    return value;
  }
  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    return findRecipeObject(graph);
  }
  return null;
}

function isRecipeType(value: unknown): boolean {
  if (typeof value === "string") {
    return value.toLowerCase() === "recipe";
  }
  return Array.isArray(value) && value.some(isRecipeType);
}

function jsonLdToRawRecipe(recipe: Record<string, unknown>, sourceUrl: string): RawRecipe {
  const name = getString(recipe.name);
  const ingredients = getStringArray(recipe.recipeIngredient);
  const steps = parseInstructionList(recipe.recipeInstructions);
  if (!name || ingredients.length === 0 || steps.length === 0) {
    throwProblem({
      status: 422,
      title: "Recipe parse failed",
      detail: "JSON-LD Recipe is missing name, ingredients, or instructions",
    });
  }

  const prepMinutes = parseIsoDurationMinutes(getString(recipe.prepTime));
  const cookMinutes = parseIsoDurationMinutes(getString(recipe.cookTime));
  const timeMinutes = parseIsoDurationMinutes(getString(recipe.totalTime)) ??
    (prepMinutes || cookMinutes ? (prepMinutes ?? 0) + (cookMinutes ?? 0) : undefined);

  return {
    sourceUrl,
    sourceSite: new URL(sourceUrl).hostname,
    name,
    description: getString(recipe.description),
    ingredients,
    steps,
    imageUrl: parseImageUrl(recipe.image),
    timeMinutes,
    servings: parseServings(recipe.recipeYield),
    difficulty: difficultyFromMinutes(timeMinutes, steps.length),
    tags: normalizeTags([
      "web_crawled",
      ...getKeywordStrings(recipe.keywords),
      ...getKeywordStrings(recipe.recipeCategory),
      ...getKeywordStrings(recipe.recipeCuisine),
    ]),
    nutrition: parseNutrition(recipe.nutrition),
  };
}

function htmlToRawRecipe(html: string, sourceUrl: string): RawRecipe {
  const heading = cleanText(html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
  const name = extractMetaContent(html, "og:title") ?? (heading || "웹 레시피");
  const description = extractMetaContent(html, "og:description");
  const imageUrl = extractMetaContent(html, "og:image");
  const timeMinutes = parseKoreanMinutes(cleanText(html.match(/view2_summary_info2["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""));
  const servings = parseServings(cleanText(html.match(/view2_summary_info1["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""));
  const ingredients = parseHtmlIngredients(html);
  const steps = parseHtmlSteps(html);

  return {
    sourceUrl,
    sourceSite: new URL(sourceUrl).hostname,
    name,
    description,
    ingredients,
    steps,
    imageUrl,
    timeMinutes,
    servings,
    difficulty: difficultyFromMinutes(timeMinutes, steps.length),
    tags: ["web_crawled"],
  };
}

function parseHtmlIngredients(html: string): string[] {
  const ingredients: string[] = [];
  const ingredientMatches = html.matchAll(
    /<li>\s*<div[^>]*class=["'][^"']*ingre_list_name[^"']*["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<span[^>]*class=["'][^"']*ingre_list_ea[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
  );
  for (const match of ingredientMatches) {
    const name = cleanText(match[1] ?? "");
    const quantity = cleanText(match[2] ?? "");
    if (name) {
      ingredients.push(`${name}${quantity ? ` ${quantity}` : ""}`.trim());
    }
  }
  return Array.from(new Set(ingredients)).slice(0, 40);
}

function parseHtmlSteps(html: string): string[] {
  const steps = Array.from(html.matchAll(/id=["']stepdescr(\d+)["'][^>]*>([\s\S]*?)<\/div>/gi))
    .map((match) => ({
      order: Number(match[1]),
      text: cleanText(match[2] ?? ""),
    }))
    .filter((step) => Number.isFinite(step.order) && step.text.length > 0)
    .sort((left, right) => left.order - right.order)
    .map((step) => step.text);
  return steps.slice(0, 30);
}

async function normalizeRecipeWithOpenAI(raw: RawRecipe): Promise<Omit<CrawledRecipeCandidate, "sourceUrl" | "sourceSite"> | null> {
  try {
    const completion = await createOpenAIJsonCompletion({
      maxTokens: 2200,
      messages: [
        {
          role: "system",
          content:
            "You normalize crawled real recipe data into a Korean app RecipeDto. Do not invent a recipe. Preserve source ingredients and steps; only clean names, quantities, tags, and durations. Return JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            input: {
              name: raw.name,
              description: raw.description,
              ingredients: raw.ingredients.slice(0, 30),
              steps: raw.steps.slice(0, 20),
              imageUrl: raw.imageUrl,
              timeMinutes: raw.timeMinutes,
              servings: raw.servings,
              tags: raw.tags,
            },
            outputShape: {
              recipe: {
                name: "string",
                description: "short Korean summary",
                ingredients: [{ name: "ingredient", quantity: "amount label", avatar: "emoji" }],
                timeMinutes: "integer",
                servings: "integer",
                difficulty: "easy|medium|hard",
                tags: ["web_crawled", "under_15_min", "no_heat", "kid_friendly", "soup", "rice", "warm", "simple"],
                dietaryFlags: ["string"],
                steps: [{ order: "integer", description: "Korean instruction", durationMinutes: "integer optional" }],
                nutrition: {},
              },
            },
          }),
        },
      ],
    });
    if (!completion) return null;

    const parsed = parseOpenAIJsonObject(completion.content);
    const recipe = isRecord(parsed?.recipe) ? parsed.recipe : parsed;
    if (!isRecord(recipe)) return null;

    const name = getString(recipe.name) ?? raw.name;
    const ingredients = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.flatMap(parseRecipeIngredientRecord).slice(0, 30)
      : [];
    const steps = Array.isArray(recipe.steps)
      ? recipe.steps.flatMap(parseRecipeStepRecord).slice(0, 30)
      : [];
    if (ingredients.length === 0 || steps.length === 0) {
      return null;
    }

    const timeMinutes = normalizePositiveInteger(recipe.timeMinutes) ?? raw.timeMinutes ?? estimateTimeMinutes(steps.length);
    return {
      name,
      ingredients,
      time: `${timeMinutes}분`,
      timeMinutes,
      description: getString(recipe.description) ?? raw.description,
      imageUrl: getString(recipe.imageUrl) ?? raw.imageUrl,
      servings: normalizePositiveInteger(recipe.servings) ?? raw.servings,
      difficulty: parseDifficulty(recipe.difficulty) ?? difficultyFromMinutes(timeMinutes, steps.length),
      tags: normalizeTags([
        ...raw.tags,
        ...getStringArray(recipe.tags),
        timeMinutes <= 15 ? "under_15_min" : "",
      ]),
      dietaryFlags: getStringArray(recipe.dietaryFlags),
      steps,
      nutrition: isRecord(recipe.nutrition) ? parseNutrition(recipe.nutrition) : raw.nutrition,
    };
  } catch {
    return null;
  }
}

function normalizeRecipeFallback(raw: RawRecipe): Omit<CrawledRecipeCandidate, "sourceUrl" | "sourceSite"> {
  const ingredients = raw.ingredients
    .map(parseIngredientLine)
    .filter((ingredient): ingredient is RecipeIngredientDto => ingredient !== null)
    .slice(0, 30);
  const steps = raw.steps.map((description, index): RecipeStepDto => ({
    order: index + 1,
    description,
  }));
  const timeMinutes = raw.timeMinutes ?? estimateTimeMinutes(steps.length);

  return {
    name: raw.name,
    ingredients,
    time: `${timeMinutes}분`,
    timeMinutes,
    description: raw.description,
    imageUrl: raw.imageUrl,
    servings: raw.servings,
    difficulty: raw.difficulty ?? difficultyFromMinutes(timeMinutes, steps.length),
    tags: normalizeTags([
      ...raw.tags,
      timeMinutes <= 15 ? "under_15_min" : "",
      isNoHeatRecipe(raw.steps) ? "no_heat" : "",
    ]),
    dietaryFlags: [],
    steps,
    nutrition: raw.nutrition,
  };
}

function parseRecipeIngredientRecord(value: unknown): RecipeIngredientDto[] {
  if (!isRecord(value)) {
    return [];
  }
  const name = getString(value.name);
  if (!name) {
    return [];
  }
  return [{
    name,
    quantity: getString(value.quantity) ?? "적당량",
    avatar: getString(value.avatar) ?? avatarForIngredient(name),
  }];
}

function parseRecipeStepRecord(value: unknown): RecipeStepDto[] {
  if (!isRecord(value)) {
    return [];
  }
  const description = getString(value.description) ?? getString(value.text);
  if (!description) {
    return [];
  }
  return [{
    order: normalizePositiveInteger(value.order) ?? 1,
    description,
    durationMinutes: normalizePositiveInteger(value.durationMinutes),
  }];
}

function parseIngredientLine(line: string): RecipeIngredientDto | null {
  const cleaned = cleanText(line);
  if (!cleaned) return null;

  const match = cleaned.match(/^(.+?)\s+((?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\.\d+)\s*\S+|약간|조금|적당량|기호에\s*맞게)$/i);
  const name = cleanText(match?.[1] ?? cleaned);
  const quantity = cleanText(match?.[2] ?? "적당량");
  if (!name) return null;

  return {
    name,
    quantity,
    avatar: avatarForIngredient(name),
  };
}

function parseInstructionList(value: unknown): string[] {
  if (typeof value === "string") {
    return [cleanText(value)].filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap(parseInstructionList).filter(Boolean);
  }
  if (!isRecord(value)) {
    return [];
  }

  const itemList = value.itemListElement;
  const directText = getString(value.text) ?? getString(value.name);
  const nested = Array.isArray(itemList) ? itemList.flatMap(parseInstructionList) : [];
  return [
    ...(directText ? [cleanText(directText)] : []),
    ...nested,
  ].filter(Boolean);
}

function parseImageUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(parseImageUrl).find((url) => typeof url === "string");
  }
  if (isRecord(value)) {
    return getString(value.url) ?? getString(value.contentUrl);
  }
  return undefined;
}

function parseNutrition(value: unknown): RecipeNutritionDto | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const nutrition: RecipeNutritionDto = {};
  setNutritionValue(nutrition, "caloriesKcal", value.calories);
  setNutritionValue(nutrition, "proteinG", value.proteinContent);
  setNutritionValue(nutrition, "carbsG", value.carbohydrateContent);
  setNutritionValue(nutrition, "fatG", value.fatContent);
  setNutritionValue(nutrition, "fiberG", value.fiberContent);
  setNutritionValue(nutrition, "sodiumMg", value.sodiumContent);
  return Object.keys(nutrition).length > 0 ? nutrition : undefined;
}

function setNutritionValue(nutrition: RecipeNutritionDto, key: keyof RecipeNutritionDto, value: unknown): void {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^\d.]/g, ""));
  if (Number.isFinite(number) && number > 0) {
    nutrition[key] = number;
  }
}

function parseIsoDurationMinutes(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return undefined;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const total = days * 24 * 60 + hours * 60 + minutes;
  return total > 0 ? total : undefined;
}

function parseKoreanMinutes(value: string): number | undefined {
  const hours = Number(value.match(/(\d+)\s*시간/)?.[1] ?? 0);
  const minutes = Number(value.match(/(\d+)\s*분/)?.[1] ?? 0);
  const total = hours * 60 + minutes;
  return total > 0 ? total : undefined;
}

function parseServings(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value > 0 ? Math.trunc(value) : undefined;
  }
  if (Array.isArray(value)) {
    return value.map(parseServings).find((serving) => typeof serving === "number");
  }
  const match = String(value ?? "").match(/(\d+)/);
  const servings = match ? Number(match[1]) : NaN;
  return Number.isFinite(servings) && servings > 0 ? servings : undefined;
}

function parseDifficulty(value: unknown): RecipeDto["difficulty"] | undefined {
  return value === "easy" || value === "medium" || value === "hard" ? value : undefined;
}

function difficultyFromMinutes(minutes: number | undefined, stepCount: number): "easy" | "medium" | "hard" {
  if ((minutes ?? 0) <= 20 && stepCount <= 6) return "easy";
  if ((minutes ?? 0) <= 60 && stepCount <= 12) return "medium";
  return "hard";
}

function estimateTimeMinutes(stepCount: number): number {
  return Math.max(10, Math.min(90, stepCount * 5));
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : undefined;
}

function getKeywordStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/[,#]/g).map((item) => item.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap(getKeywordStrings);
  }
  return [];
}

function getStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return [value].filter(Boolean);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(getStringArray).map(cleanText).filter(Boolean);
}

function normalizeTags(values: string[]): string[] {
  return Array.from(new Set(values
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean)))
    .slice(0, 20);
}

function isNoHeatRecipe(steps: string[]): boolean {
  const text = steps.join(" ");
  return !/(끓|굽|볶|튀|삶|오븐|팬|불|전자레인지|데치)/.test(text);
}

function avatarForIngredient(name: string): string {
  const rules: Array<[RegExp, string]> = [
    [/두부|치즈|묵/, "⬜"],
    [/상추|깻잎|시금치|부추|양배추|배추|브로콜리/, "🥬"],
    [/오이|애호박|호박|대파|파/, "🥒"],
    [/버섯/, "🍄"],
    [/토마토|고추|파프리카/, "🍅"],
    [/계란|달걀/, "🥚"],
    [/닭|소고기|돼지고기|고기|햄|스팸/, "🥩"],
    [/생선|연어|참치|멸치|바지락|해물|새우/, "🐟"],
    [/밥|쌀|면|국수|떡/, "🍚"],
    [/김치/, "🥬"],
  ];
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? "🥣";
}

function extractMetaContent(html: string, key: string): string | undefined {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (!new RegExp(`(?:property|name)=["']${escapeRegExp(key)}["']`, "i").test(tag)) {
      continue;
    }
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) {
      return cleanText(content);
    }
  }
  return undefined;
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+구매$/g, "")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
