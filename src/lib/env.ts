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

  // Vercel Cron secret. Vercel auto-injects a `CRON_SECRET` env var and sends
  // it as `Authorization: Bearer ${CRON_SECRET}` when invoking scheduled
  // routes. Setting this on the project lets cron paths verify the caller.
  CRON_SECRET: z.string().optional().default(""),

  // Salt for the IP-hash in query_logs. Without this the IP hash is
  // SHA-256(raw IP) — easily reversed via a 4-billion-row rainbow table.
  // With it, the IP becomes HMAC-SHA-256(IP, salt) — practically unrecoverable.
  // Generate with: openssl rand -hex 32
  IP_HASH_SALT: z.string().optional().default(""),

  // ── Cron failure alerting (all optional) ───────────────────────────────
  // refresh-registry skips notification silently when none of these are set.
  // Configure either channel — or both — to get pinged when a scraper
  // reports status='error' or 'partial' in a real run.

  // Resend (https://resend.com) email channel. Free tier: 100 emails/day.
  // Both vars must be set to enable email alerts.
  RESEND_API_KEY: z.string().optional().default(""),
  ALERT_EMAIL: z.string().optional().default(""),

  // Generic webhook channel. Posts a JSON body with a `text` field — works
  // for Slack and Discord incoming webhooks, or any consumer that accepts
  // `{ text: string }`.
  ALERT_WEBHOOK_URL: z.string().optional().default(""),

  // Public URL of the deployed app, embedded in alert bodies as the link
  // back to /admin. Falls back to the production URL.
  APP_PUBLIC_URL: z
    .string()
    .optional()
    .default("https://pim-ai-global.vercel.app"),
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
