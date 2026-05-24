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

export type OpenAIJsonCompletion = {
  content: string;
  model: string;
  latencyMs: number;
};

let openaiClient: OpenAIClient | undefined;

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
  const startedAt = Date.now();
  const payload = {
    model,
    messages: input.messages,
    response_format: { type: "json_object" },
    stream: false,
  } as Parameters<typeof client.chat.completions.create>[0];
  const tokenLimitKey = usesMaxCompletionTokens(model) ? "max_completion_tokens" : "max_tokens";
  Object.assign(payload, { [tokenLimitKey]: input.maxTokens ?? 1200 });

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
