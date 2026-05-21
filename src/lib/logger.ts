import crypto from "crypto";
import { getServiceClient } from "@/lib/supabase";
import { getServerEnv } from "@/lib/env";

export interface QueryLogEntry {
  query_text: string;
  collection: string;
  model: string;
  provider?: string;
  ip?: string;
  embedding_ms?: number;
  retrieval_ms?: number;
  llm_ms?: number;
  total_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  chunk_count?: number;
  cache_hit?: boolean;
  error?: string;
}

/**
 * Hash an IP address for storage in query_logs.
 *
 * If `IP_HASH_SALT` is set, this is HMAC-SHA-256 keyed with the salt —
 * effectively unrecoverable.
 *
 * If not set, falls back to plain SHA-256 (legacy behaviour) with a console
 * warning the first time it's used in a process. Plain SHA-256 of an IPv4 is
 * trivially reversible via a 4-billion-row rainbow table.
 */
let _warnedNoSalt = false;
function hashIp(ip: string): string {
  const salt = getServerEnv().IP_HASH_SALT;
  if (salt) {
    return crypto
      .createHmac("sha256", salt)
      .update(ip)
      .digest("hex")
      .substring(0, 16);
  }
  if (!_warnedNoSalt) {
    console.warn(
      "[logger] IP_HASH_SALT is not set — falling back to unsalted SHA-256. " +
        "Add IP_HASH_SALT (openssl rand -hex 32) to Vercel env to fix."
    );
    _warnedNoSalt = true;
  }
  return crypto.createHash("sha256").update(ip).digest("hex").substring(0, 16);
}

/**
 * Log a query to the query_logs table.
 * Fire-and-forget — never blocks the response.
 */
export function logQuery(entry: QueryLogEntry): void {
  const ipHash = entry.ip ? hashIp(entry.ip) : undefined;

  const supabase = getServiceClient();

  supabase
    .from("query_logs")
    .insert({
      query_text: entry.query_text.substring(0, 2000),
      collection: entry.collection,
      model: entry.model,
      provider: entry.provider,
      ip_hash: ipHash,
      embedding_ms: entry.embedding_ms,
      retrieval_ms: entry.retrieval_ms,
      llm_ms: entry.llm_ms,
      total_ms: entry.total_ms,
      input_tokens: entry.input_tokens,
      output_tokens: entry.output_tokens,
      chunk_count: entry.chunk_count,
      cache_hit: entry.cache_hit ?? false,
      error: entry.error,
    })
    .then(({ error }) => {
      if (error) console.error("Failed to log query:", error.message);
    });
}

/**
 * Helper to time an async operation and return [result, durationMs].
 */
export async function timed<T>(
  fn: () => Promise<T>
): Promise<[T, number]> {
  const start = Date.now();
  const result = await fn();
  return [result, Date.now() - start];
}
