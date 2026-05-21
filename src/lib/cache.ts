import crypto from "crypto";
import { getServiceClient } from "@/lib/supabase";

// ── Helpers ─────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text.toLowerCase().trim()).digest("hex");
}

// Cache TTLs. The response cache is keyed by normalized query (lower-cased)
// across all users, so a poisoned/policy-violating answer would persist for
// the TTL. Keep it short — 1 hour is a good balance of perf benefit (most
// repeat queries are within minutes) and reduced blast radius. Embeddings
// can keep their 30-day TTL because they're objective and not user-facing
// answer content.
const RESPONSE_TTL_MS = 60 * 60 * 1000;          // 1 hour
const EMBEDDING_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Embedding Cache ─────────────────────────────────────────────────────

export async function getCachedEmbedding(
  queryText: string
): Promise<number[] | null> {
  const hash = sha256(queryText);
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("embedding_cache")
    .select("embedding, created_at")
    .eq("query_hash", hash)
    .maybeSingle();

  if (error || !data) return null;

  // Check TTL
  const age = Date.now() - new Date(data.created_at).getTime();
  if (age > EMBEDDING_TTL_MS) return null;

  // Increment hit count (fire and forget). Typed RPC — parameterized,
  // safe, no string interpolation. Defined in migration 011.
  void supabase.rpc("increment_embedding_cache_hit", { p_hash: hash });

  // Parse the embedding - pgvector returns it as a string "[0.1,0.2,...]"
  const embedding = typeof data.embedding === "string"
    ? JSON.parse(data.embedding)
    : data.embedding;

  return embedding;
}

export async function setCachedEmbedding(
  queryText: string,
  embedding: number[]
): Promise<void> {
  const hash = sha256(queryText);
  const supabase = getServiceClient();

  // Upsert to handle race conditions
  await supabase.from("embedding_cache").upsert(
    {
      query_hash: hash,
      query_text: queryText.trim().substring(0, 2000),
      embedding: JSON.stringify(embedding),
      hit_count: 0,
    },
    { onConflict: "query_hash" }
  );
}

// ── Response Cache ──────────────────────────────────────────────────────

interface CachedResponse {
  answer: string;
  sources: Array<{
    file: string;
    page: number;
    similarity: number;
    excerpt: string;
  }>;
  provider: string;
  input_tokens: number;
  output_tokens: number;
}

export function responseCacheKey(
  query: string,
  collection: string,
  model: string
): string {
  return sha256(`${query}||${collection}||${model}`);
}

export async function getCachedResponse(
  cacheKey: string
): Promise<CachedResponse | null> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("response_cache")
    .select("answer, sources, provider, input_tokens, output_tokens, created_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error || !data) return null;

  // Check TTL
  const age = Date.now() - new Date(data.created_at).getTime();
  if (age > RESPONSE_TTL_MS) return null;

  // Increment hit count (fire and forget). Typed RPC — parameterized,
  // safe, no string interpolation. Defined in migration 011.
  void supabase.rpc("increment_response_cache_hit", { p_key: cacheKey });

  return {
    answer: data.answer,
    sources: data.sources as CachedResponse["sources"],
    provider: data.provider ?? "",
    input_tokens: data.input_tokens ?? 0,
    output_tokens: data.output_tokens ?? 0,
  };
}

export async function setCachedResponse(
  cacheKey: string,
  query: string,
  collection: string,
  model: string,
  response: CachedResponse
): Promise<void> {
  const supabase = getServiceClient();

  await supabase.from("response_cache").upsert(
    {
      cache_key: cacheKey,
      query_text: query.trim().substring(0, 2000),
      collection,
      model,
      answer: response.answer,
      sources: response.sources,
      provider: response.provider,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      hit_count: 0,
    },
    { onConflict: "cache_key" }
  );
}
