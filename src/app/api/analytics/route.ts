import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const revalidate = 60;

export async function GET() {
  try {
    const supabase = getServiceClient();

    // Run queries in parallel
    const [recentLogs, embeddingCacheCount, responseCacheCount] =
      await Promise.all([
        // Last 50 queries
        supabase
          .from("query_logs")
          .select(
            "id, query_text, collection, model, provider, embedding_ms, retrieval_ms, llm_ms, total_ms, input_tokens, output_tokens, chunk_count, cache_hit, error, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(50),

        // Embedding cache count
        supabase
          .from("embedding_cache")
          .select("id", { count: "exact", head: true }),

        // Response cache count
        supabase
          .from("response_cache")
          .select("id", { count: "exact", head: true }),
      ]);

    // Compute summary from the recent logs
    const logs = recentLogs.data ?? [];
    const last24h = logs.filter(
      (l) =>
        new Date(l.created_at).getTime() > Date.now() - 24 * 60 * 60 * 1000
    );

    const summary = {
      total_queries: last24h.length,
      avg_total_ms: last24h.length
        ? Math.round(
            last24h.reduce((s, l) => s + (l.total_ms ?? 0), 0) / last24h.length
          )
        : 0,
      avg_embedding_ms: last24h.length
        ? Math.round(
            last24h.reduce((s, l) => s + (l.embedding_ms ?? 0), 0) /
              last24h.length
          )
        : 0,
      avg_retrieval_ms: last24h.length
        ? Math.round(
            last24h.reduce((s, l) => s + (l.retrieval_ms ?? 0), 0) /
              last24h.length
          )
        : 0,
      avg_llm_ms: last24h.length
        ? Math.round(
            last24h.reduce((s, l) => s + (l.llm_ms ?? 0), 0) / last24h.length
          )
        : 0,
      cache_hits: last24h.filter((l) => l.cache_hit).length,
      errors: last24h.filter((l) => l.error).length,
      total_input_tokens: last24h.reduce(
        (s, l) => s + (l.input_tokens ?? 0),
        0
      ),
      total_output_tokens: last24h.reduce(
        (s, l) => s + (l.output_tokens ?? 0),
        0
      ),
    };

    return NextResponse.json(
      {
        recent: logs,
        summary_24h: summary,
        cache: {
          embedding_cache_entries: embeddingCacheCount.count ?? 0,
          response_cache_entries: responseCacheCount.count ?? 0,
        },
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Analytics API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
