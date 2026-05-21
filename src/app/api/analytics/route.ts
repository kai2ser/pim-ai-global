import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getServerEnv } from "@/lib/env";

export const runtime = "nodejs";

// Cached for 60s when the caller is admin. Public callers are 403'd before
// they reach the cache, so this revalidate hint doesn't affect access control.
export const revalidate = 60;

/**
 * Admin gate: requires `Authorization: Bearer <ADMIN_TOKEN>` header.
 * Constant-time compare to defend against timing side-channels.
 *
 * If ADMIN_TOKEN is unset (dev / new deployment), the endpoint refuses all
 * callers — this is safer than the previous unauthenticated default which
 * leaked the last 50 raw user queries.
 */
function isAdmin(req: NextRequest): boolean {
  const expected = getServerEnv().ADMIN_TOKEN;
  if (!expected) return false;

  const header = req.headers.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length !== expected.length) return false;

  // Constant-time comparison (avoids leaking length-prefix matches via timing).
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Truncate raw query text for display. Even admins shouldn't habitually
 * read full queries from logs — the table is the source of truth if a
 * targeted lookup is needed.
 */
function redactQuery(s: string | null | undefined): string {
  if (!s) return "";
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      {
        status: 403,
        headers: { "X-Robots-Tag": "noindex, nofollow" },
      }
    );
  }

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
    const rawLogs = recentLogs.data ?? [];
    const last24h = rawLogs.filter(
      (l) =>
        new Date(l.created_at).getTime() > Date.now() - 24 * 60 * 60 * 1000
    );

    // Redact query_text in the response — even admins see only the first
    // 80 chars. Full text remains in the DB for targeted SQL lookups.
    const logs = rawLogs.map((l) => ({ ...l, query_text: redactQuery(l.query_text) }));

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
            "private, s-maxage=60, stale-while-revalidate=300",
          "X-Robots-Tag": "noindex, nofollow",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Analytics API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
