/**
 * Shared model definitions — safe for both client and server.
 * No API keys or provider SDKs imported here.
 */

export interface ModelOption {
  id: string;
  label: string;
  provider: "anthropic" | "openai";
  description: string;
}

export const MODELS: ModelOption[] = [
  {
    id: "claude-sonnet",
    label: "Claude Sonnet 4",
    provider: "anthropic",
    description: "Anthropic's balanced model — fast, accurate, cost-effective.",
  },
  {
    id: "claude-haiku",
    label: "Claude Haiku 3.5",
    provider: "anthropic",
    description: "Anthropic's fastest model — low latency, lower cost.",
  },
  {
    id: "claude-opus",
    label: "Claude Opus 4",
    provider: "anthropic",
    description: "Anthropic's most capable model — best reasoning, higher cost.",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    description: "OpenAI's flagship multimodal model — strong all-around.",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    description: "OpenAI's efficient model — fast and affordable.",
  },
  {
    id: "o3-mini",
    label: "o3-mini",
    provider: "openai",
    description: "OpenAI's reasoning model — strong on analytical tasks.",
  },
];

export const DEFAULT_MODEL = "claude-sonnet";
