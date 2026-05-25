type ChatImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
};

type ChatTextContent = {
  type: "text";
  text: string;
};

type ChatMessage = {
  role: "system" | "user";
  content: string | Array<ChatTextContent | ChatImageContent>;
};

type OpenAIClient = Awaited<ReturnType<typeof createOpenAIClient>>;
type TokenBudgetReservation = {
  estimatedTokens: number;
  reservedAt: number;
};

export type OpenAIJsonCompletion = {
  content: string;
  model: string;
  latencyMs: number;
};

let openaiClient: OpenAIClient | undefined;
const tokenReservations: TokenBudgetReservation[] = [];

async function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const { default: OpenAI } = await import("openai");
    return new OpenAI({ apiKey });
  } catch {
    return null;
  }
}

export async function getOpenAIClient() {
  if (openaiClient === undefined) {
    openaiClient = await createOpenAIClient();
  }
  return openaiClient;
}

export function getOpenAITextModel(): string {
  return process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
}

export async function createOpenAIJsonCompletion(input: {
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
}): Promise<OpenAIJsonCompletion | null> {
  const client = await getOpenAIClient();
  if (!client) return null;

  const model = input.model ?? getOpenAITextModel();
  const maxTokens = Math.min(input.maxTokens ?? 1200, getMaxCompletionTokens());
  if (!reserveRollingTokenBudget(estimateRequestTokens(input.messages, maxTokens))) {
    if (process.env.OPENAI_BUDGET_LOG === "true") {
      console.warn({ event: "openai_budget_exhausted", model });
    }
    return null;
  }
  const startedAt = Date.now();
  const payload = {
    model,
    messages: input.messages,
    response_format: { type: "json_object" },
    stream: false,
  } as Parameters<typeof client.chat.completions.create>[0];
  const tokenLimitKey = usesMaxCompletionTokens(model) ? "max_completion_tokens" : "max_tokens";
  Object.assign(payload, { [tokenLimitKey]: maxTokens });

  const response = await client.chat.completions.create(payload);
  if (!("choices" in response)) {
    return null;
  }
  const content = response.choices[0]?.message?.content?.trim();
  if (!content) return null;

  return {
    content,
    model,
    latencyMs: Date.now() - startedAt,
  };
}

function reserveRollingTokenBudget(estimatedTokens: number): boolean {
  const budget = Number(process.env.OPENAI_ROLLING_TOKEN_BUDGET ?? 120_000);
  if (!Number.isFinite(budget) || budget <= 0) {
    return true;
  }

  const now = Date.now();
  const windowMs = normalizePositiveNumber(process.env.OPENAI_ROLLING_TOKEN_WINDOW_MINUTES, 60) * 60_000;
  while (tokenReservations[0] && now - tokenReservations[0].reservedAt > windowMs) {
    tokenReservations.shift();
  }

  const used = tokenReservations.reduce((sum, reservation) => sum + reservation.estimatedTokens, 0);
  if (used + estimatedTokens > budget) {
    return false;
  }

  tokenReservations.push({ estimatedTokens, reservedAt: now });
  return true;
}

function estimateRequestTokens(messages: ChatMessage[], maxCompletionTokens: number): number {
  const textLength = messages.reduce((sum, message) => sum + estimateMessageTextLength(message), 0);
  return Math.ceil(textLength / 4) + maxCompletionTokens;
}

function estimateMessageTextLength(message: ChatMessage): number {
  if (typeof message.content === "string") {
    return message.content.length;
  }
  return message.content.reduce((sum, part) => {
    if (part.type === "text") return sum + part.text.length;
    return sum + Math.min(part.image_url.url.length / 24, 2400);
  }, 0);
}

function getMaxCompletionTokens(): number {
  return Math.trunc(normalizePositiveNumber(process.env.OPENAI_MAX_COMPLETION_TOKENS, 1600));
}

function normalizePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function usesMaxCompletionTokens(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4");
}

export function parseOpenAIJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
