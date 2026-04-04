import { z } from "zod";

/**
 * Server-side environment variable validation.
 * Import this at the top of any server module that needs env vars.
 * Throws a clear error on missing/invalid variables at startup.
 */

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  OPENAI_API_KEY: z
    .string()
    .startsWith("sk-", "OPENAI_API_KEY must start with 'sk-'"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  CLAUDE_API_KEY: z.string().optional().default(""),
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

  // Ensure at least one Anthropic key is set
  if (!result.data.ANTHROPIC_API_KEY && !result.data.CLAUDE_API_KEY) {
    throw new Error(
      "At least one of ANTHROPIC_API_KEY or CLAUDE_API_KEY must be set."
    );
  }

  _validated = result.data;
  return _validated;
}
