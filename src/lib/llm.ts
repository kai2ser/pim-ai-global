/**
 * Multi-LLM Router
 * -----------------
 * Unified interface for generating answers from different LLM providers.
 * Add new providers by extending the switch in generateAnswer().
 *
 * To add a new provider (e.g., Google Gemini, Mistral, Llama via Together):
 *   1. Add model entries to src/lib/models.ts
 *   2. Add a new case in generateAnswer() below
 *   3. Set the API key in .env.local and Vercel
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// ── Types ───────────────────────────────────────────────────────────────

export interface LLMResponse {
  text: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

// ── Model → Provider ID mapping ─────────────────────────────────────────

const MODEL_MAP: Record<string, { provider: string; modelId: string }> = {
  "claude-sonnet": { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
  "claude-haiku": { provider: "anthropic", modelId: "claude-3-5-haiku-20241022" },
  "claude-opus": { provider: "anthropic", modelId: "claude-opus-4-20250514" },
  "gpt-4o": { provider: "openai", modelId: "gpt-4o" },
  "gpt-4o-mini": { provider: "openai", modelId: "gpt-4o-mini" },
  "o3-mini": { provider: "openai", modelId: "o3-mini" },
};

// ── Main Router ─────────────────────────────────────────────────────────

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

  // ── Anthropic ───────────────────────────────────────────────────────
  if (entry.provider === "anthropic") {
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const client = new Anthropic({ apiKey });
    const start = Date.now();

    const message = await client.messages.create({
      model: entry.modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    return {
      text,
      model: message.model,
      provider: "Anthropic",
      inputTokens: message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
      latencyMs: Date.now() - start,
    };
  }

  // ── OpenAI ──────────────────────────────────────────────────────────
  if (entry.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const client = new OpenAI({ apiKey });
    const start = Date.now();

    const response = await client.chat.completions.create({
      model: entry.modelId,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const text = response.choices[0]?.message?.content || "";

    return {
      text,
      model: response.model,
      provider: "OpenAI",
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      latencyMs: Date.now() - start,
    };
  }

  // ── Future providers go here ────────────────────────────────────────
  // if (entry.provider === "google") { ... }
  // if (entry.provider === "together") { ... }

  throw new Error(`Provider "${entry.provider}" not implemented yet`);
}

// ── Streaming Router ───────────────────────────────────────────────────

export async function* generateAnswerStream(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 2048
): AsyncGenerator<{ type: "text" | "done"; content: string; model?: string; provider?: string; inputTokens?: number; outputTokens?: number }> {
  const entry = MODEL_MAP[modelId];
  if (!entry) {
    throw new Error(
      `Unknown model: ${modelId}. Available: ${Object.keys(MODEL_MAP).join(", ")}`
    );
  }

  // ── Anthropic Streaming ─────────────────────────────────────────────
  if (entry.provider === "anthropic") {
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const client = new Anthropic({ apiKey });

    const stream = client.messages.stream({
      model: entry.modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text", content: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: "done",
      content: "",
      model: finalMessage.model,
      provider: "Anthropic",
      inputTokens: finalMessage.usage?.input_tokens,
      outputTokens: finalMessage.usage?.output_tokens,
    };
    return;
  }

  // ── OpenAI Streaming ────────────────────────────────────────────────
  if (entry.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const client = new OpenAI({ apiKey });

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
      if (delta) {
        yield { type: "text", content: delta };
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    yield {
      type: "done",
      content: "",
      model: entry.modelId,
      provider: "OpenAI",
      inputTokens,
      outputTokens,
    };
    return;
  }

  throw new Error(`Provider "${entry.provider}" not implemented yet`);
}
