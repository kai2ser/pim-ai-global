import { z } from "zod";

/**
 * Server-side environment variable validation.
 * Import this at the top of any server module that needs env vars.
 * Throws a clear error on missing/invalid variables at startup.
 */

const serverEnvSchema = z.object({
  // Supabase (always required)
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  // OpenAI: user key for live query embeddings + chat completions
  OPENAI_API_KEY: z
    .string()
    .startsWith("sk-", "OPENAI_API_KEY must start with 'sk-'"),

  // OpenAI admin key — for ingest/embed scripts only.
  // Lets admins set a separate, higher spending limit on this key without
  // exposing the live app to runaway costs. Optional at serverless runtime;
  // required at script time (scripts check explicitly).
  OPENAI_ADMIN_API_KEY: z.string().optional().default(""),

  // Anthropic — required for the Claude models in the dropdown.
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  CLAUDE_API_KEY: z.string().optional().default(""),

  // Google Gemini — optional. Without it the Gemini models in the dropdown
  // surface a clear "key not configured" error.
  GOOGLE_GENAI_API_KEY: z.string().optional().default(""),

  // Mistral — optional. Same gating as Gemini.
  MISTRAL_API_KEY: z.string().optional().default(""),

  // Admin token for /api/admin/* and /api/cron/* routes.
  // Generate with: openssl rand -hex 32
  ADMIN_TOKEN: z.string().optional().default(""),
});

// Validate once and cache
let _validated: z.infer<typeof serverEnvSchema> | null = null;

export function getServerEnv() {
  if (_validated) return _validated;

  const result = serverEnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Environment variable validation failed:\n${errors}\n\nCheck your .env.local file.`
    );
  }

  // Ensure at least one Anthropic key is set so the default model works.
  if (!result.data.ANTHROPIC_API_KEY && !result.data.CLAUDE_API_KEY) {
    throw new Error(
      "At least one of ANTHROPIC_API_KEY or CLAUDE_API_KEY must be set."
    );
  }

  _validated = result.data;
  return _validated;
}
