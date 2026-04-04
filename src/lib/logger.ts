import crypto from "crypto";
import { getServiceClient } from "@/lib/supabase";

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
 * Log a query to the query_logs table.
 * Fire-and-forget — never blocks the response.
 */
export function logQuery(entry: QueryLogEntry): void {
  // Hash IP for privacy (never store raw IPs)
  const ipHash = entry.ip
    ? crypto.createHash("sha256").update(entry.ip).digest("hex").substring(0, 16)
    : undefined;

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
