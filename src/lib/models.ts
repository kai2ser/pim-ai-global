/**
 * Shared model definitions — safe for both client and server.
 * No API keys or provider SDKs imported here.
 *
 * Provider keys (server-side, validated in env.ts):
 *   - Anthropic: ANTHROPIC_API_KEY or CLAUDE_API_KEY
 *   - OpenAI:    OPENAI_API_KEY
 *   - Google:    GOOGLE_GENAI_API_KEY
 *   - Mistral:   MISTRAL_API_KEY
 *
 * Provider/model IDs drift fast (Google deprecated 2.0-flash for new accounts
 * within a year). Keep all version-pinned IDs in src/lib/llm.ts MODEL_MAP.
 */

export type ProviderId = "anthropic" | "openai" | "google" | "mistral";

export interface ModelOption {
  id: string;
  label: string;
  provider: ProviderId;
  description: string;
}

export const MODELS: ModelOption[] = [
  {
    id: "claude-sonnet",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    description: "Anthropic's balanced model — fast, accurate, cost-effective.",
  },
  {
    id: "claude-haiku",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    description: "Anthropic's fastest model — low latency, lower cost.",
  },
  {
    id: "claude-opus",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    description: "Anthropic's most capable model — best reasoning, highest cost.",
  },
  {
    id: "gpt-4o",
    label: "GPT-5.5",
    provider: "openai",
    description: "OpenAI's flagship — strongest all-around with built-in reasoning.",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-5.4 Mini",
    provider: "openai",
    description: "OpenAI's efficient tier — fast and affordable.",
  },
  {
    id: "o3-mini",
    label: "GPT-5.4 Nano",
    provider: "openai",
    description: "OpenAI's lightest tier — lowest latency, lowest cost.",
  },
  {
    id: "gemini-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    description: "Google's flagship — long context, strong on technical documents.",
  },
  {
    id: "gemini-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    description: "Google's fast tier — low latency, lower cost.",
  },
  {
    id: "mistral-large",
    label: "Mistral Large",
    provider: "mistral",
    description: "Mistral's flagship — multilingual, strong on EU-language sources.",
  },
];

export const DEFAULT_MODEL = "claude-sonnet";
