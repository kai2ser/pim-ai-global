/**
 * Multi-LLM Router
 * -----------------
 * Unified interface for generating answers from different LLM providers.
 *
 * To add a new provider:
 *   1. Add model entries to src/lib/models.ts (the user-facing dropdown)
 *   2. Add the provider's version-pinned model id to MODEL_MAP below
 *   3. Add a new case here for generateAnswer + generateAnswerStream
 *   4. Add the API key env var to env.ts and Vercel
 *
 * Provider SDKs (Anthropic, OpenAI) are dynamically imported on first use
 * for the matching provider, so a request that only uses Gemini doesn't pay
 * the cold-start cost of loading the Anthropic + OpenAI SDKs (~3-4 MB).
 *
 * Mistral uses OpenAI's SDK against the Mistral API (their REST API is
 * OpenAI-compatible). Gemini uses raw fetch.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";

// ── Cached dynamic imports ──────────────────────────────────────────────

let _anthropicMod: Promise<typeof import("@anthropic-ai/sdk")> | null = null;
function loadAnthropic() {
  if (!_anthropicMod) _anthropicMod = import("@anthropic-ai/sdk");
  return _anthropicMod;
}

let _openaiMod: Promise<typeof import("openai")> | null = null;
function loadOpenAI() {
  if (!_openaiMod) _openaiMod = import("openai");
  return _openaiMod;
}

// ── Error helpers ──────────────────────────────────────────────────────

/**
 * Convert raw provider API errors into a small set of user-safe messages.
 *
 * Returns an allowlisted phrase only when we recognise the error class.
 * Anything else falls through to a generic phrase — we never echo raw
 * provider error bodies back to the browser, since they can contain
 * billing/account hints, internal IDs, or stack traces.
 */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.toLowerCase();

  if (m.includes("overloaded")) {
    return "The AI model is temporarily overloaded. Please try again in a few seconds, or switch to a different model.";
  }
  if (m.includes("rate_limit") || m.includes("rate limit") || m.includes("429")) {
    return "API rate limit reached. Please wait a moment and try again.";
  }
  if (m.includes("authentication") || m.includes("401") || m.includes("invalid x-api-key") || m.includes("api_key_invalid")) {
    return "API authentication error. Please contact the administrator.";
  }
  if (m.includes("insufficient_quota") || m.includes("billing") || m.includes("payment")) {
    return "API quota exceeded. Please contact the administrator.";
  }
  if (m.includes("context_length") || m.includes("maximum context")) {
    return "The query and context are too long for this model. Try a shorter question or a different model.";
  }
  if (m.includes("timeout") || m.includes("etimedout") || m.includes("econnreset") || m.includes("eai_again")) {
    return "The request timed out. Please try again.";
  }
  if (m.includes("no longer available") || m.includes("deprecated")) {
    return "This model has been deprecated. Please pick a different model.";
  }
  if (m.includes("content_filter") || m.includes("safety")) {
    return "The provider declined to answer due to its content policy. Try rephrasing the question.";
  }

  // Catch-all: never leak the raw provider message — could contain
  // billing/account hints, stack traces, or internal IDs.
  return "An unexpected error occurred with the AI model. Please try again or switch to a different model.";
}

// ── Types ───────────────────────────────────────────────────────────────

export interface LLMResponse {
  text: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

type ProviderName = "anthropic" | "openai" | "google" | "mistral";

interface MapEntry {
  provider: ProviderName;
  modelId: string; // version-pinned id sent to the provider's API
}

const MODEL_MAP: Record<string, MapEntry> = {
  "claude-sonnet":  { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
  "claude-haiku":   { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" },
  "claude-opus":    { provider: "anthropic", modelId: "claude-opus-4-20250514" },
  "gpt-4o":         { provider: "openai",    modelId: "gpt-4o" },
  "gpt-4o-mini":    { provider: "openai",    modelId: "gpt-4o-mini" },
  "o3-mini":        { provider: "openai",    modelId: "o3-mini" },
  "gemini-pro":     { provider: "google",    modelId: "gemini-2.5-pro" },
  "gemini-flash":   { provider: "google",    modelId: "gemini-2.5-flash" },
  "mistral-large":  { provider: "mistral",   modelId: "mistral-large-latest" },
};

// Mistral REST API is OpenAI-compatible. Reuse the OpenAI SDK with a
// custom baseURL — avoids another dependency.
async function mistralClient(apiKey: string): Promise<OpenAI> {
  const { default: OpenAICtor } = await loadOpenAI();
  return new OpenAICtor({ apiKey, baseURL: "https://api.mistral.ai/v1" });
}

async function anthropicClient(apiKey: string): Promise<Anthropic> {
  const { default: AnthropicCtor } = await loadAnthropic();
  return new AnthropicCtor({ apiKey });
}

async function openAIClient(apiKey: string): Promise<OpenAI> {
  const { default: OpenAICtor } = await loadOpenAI();
  return new OpenAICtor({ apiKey });
}

// Provider-id-to-display-label
const PROVIDER_LABEL: Record<ProviderName, string> = {
  anthropic: "Anthropic",
  openai:    "OpenAI",
  google:    "Google",
  mistral:   "Mistral",
};

// ── Main Router (non-streaming) ─────────────────────────────────────────

export async function generateAnswer(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 2048
): Promise<LLMResponse> {
  const entry = MODEL_MAP[modelId];
  if (!entry) {
    throw new Error(
      `Unknown model: ${modelId}. Available: ${Object.keys(MODEL_MAP).join(", ")}`
    );
  }
  const start = Date.now();

  // ── Anthropic ───────────────────────────────────────────────────────
  if (entry.provider === "anthropic") {
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const client = await anthropicClient(apiKey);
    const message = await client.messages.create({
      model: entry.modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return {
      text,
      model: message.model,
      provider: PROVIDER_LABEL.anthropic,
      inputTokens: message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
      latencyMs: Date.now() - start,
    };
  }

  // ── OpenAI ──────────────────────────────────────────────────────────
  if (entry.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const client = await openAIClient(apiKey);
    const response = await client.chat.completions.create({
      model: entry.modelId,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    return {
      text: response.choices[0]?.message?.content || "",
      model: response.model,
      provider: PROVIDER_LABEL.openai,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      latencyMs: Date.now() - start,
    };
  }

  // ── Mistral (OpenAI-compatible) ─────────────────────────────────────
  if (entry.provider === "mistral") {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("Missing MISTRAL_API_KEY");

    const client = await mistralClient(apiKey);
    const response = await client.chat.completions.create({
      model: entry.modelId,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    return {
      text: response.choices[0]?.message?.content || "",
      model: response.model,
      provider: PROVIDER_LABEL.mistral,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      latencyMs: Date.now() - start,
    };
  }

  // ── Google Gemini (raw REST) ────────────────────────────────────────
  if (entry.provider === "google") {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) throw new Error("Missing GOOGLE_GENAI_API_KEY");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${entry.modelId}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    return {
      text,
      model: entry.modelId,
      provider: PROVIDER_LABEL.google,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      latencyMs: Date.now() - start,
    };
  }

  throw new Error(`Provider "${entry.provider}" not implemented yet`);
}

// ── Streaming Router ───────────────────────────────────────────────────

export async function* generateAnswerStream(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 2048
): AsyncGenerator<{
  type: "text" | "done";
  content: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
}> {
  const entry = MODEL_MAP[modelId];
  if (!entry) {
    throw new Error(
      `Unknown model: ${modelId}. Available: ${Object.keys(MODEL_MAP).join(", ")}`
    );
  }

  // ── Anthropic streaming ─────────────────────────────────────────────
  if (entry.provider === "anthropic") {
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const client = await anthropicClient(apiKey);
    const stream = client.messages.stream({
      model: entry.modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", content: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    yield {
      type: "done",
      content: "",
      model: final.model,
      provider: PROVIDER_LABEL.anthropic,
      inputTokens: final.usage?.input_tokens,
      outputTokens: final.usage?.output_tokens,
    };
    return;
  }

  // ── OpenAI streaming ────────────────────────────────────────────────
  if (entry.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const client = await openAIClient(apiKey);
    const stream = await client.chat.completions.create({
      model: entry.modelId,
      max_completion_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield { type: "text", content: delta };
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }
    yield {
      type: "done",
      content: "",
      model: entry.modelId,
      provider: PROVIDER_LABEL.openai,
      inputTokens,
      outputTokens,
    };
    return;
  }

  // ── Mistral streaming (OpenAI-compatible) ───────────────────────────
  if (entry.provider === "mistral") {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("Missing MISTRAL_API_KEY");

    const client = await mistralClient(apiKey);
    const stream = await client.chat.completions.create({
      model: entry.modelId,
      max_tokens: maxTokens,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield { type: "text", content: delta };
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }
    yield {
      type: "done",
      content: "",
      model: entry.modelId,
      provider: PROVIDER_LABEL.mistral,
      inputTokens,
      outputTokens,
    };
    return;
  }

  // ── Gemini streaming (raw SSE) ──────────────────────────────────────
  if (entry.provider === "google") {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) throw new Error("Missing GOOGLE_GENAI_API_KEY");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${entry.modelId}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      }
    );
    if (!res.ok || !res.body) {
      throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Gemini SSE emits "data: {...}\n\n" frames
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!frame.startsWith("data:")) continue;
        const payload = frame.slice(5).trim();
        if (!payload) continue;
        try {
          const obj = JSON.parse(payload) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          };
          const text = obj.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
          if (text) yield { type: "text", content: text };
          if (obj.usageMetadata) {
            inputTokens = obj.usageMetadata.promptTokenCount;
            outputTokens = obj.usageMetadata.candidatesTokenCount;
          }
        } catch {
          // skip malformed frame
        }
      }
    }

    yield {
      type: "done",
      content: "",
      model: entry.modelId,
      provider: PROVIDER_LABEL.google,
      inputTokens,
      outputTokens,
    };
    return;
  }

  throw new Error(`Provider "${entry.provider}" not implemented yet`);
}
