import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, COLLECTIONS } from "@/lib/supabase";
import { getEmbedding } from "@/lib/embeddings";
import { generateAnswer, generateAnswerStream } from "@/lib/llm";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import { rateLimit } from "@/lib/rate-limit";
import {
  getCachedEmbedding,
  setCachedEmbedding,
  getCachedResponse,
  setCachedResponse,
  responseCacheKey,
} from "@/lib/cache";
import { logQuery, timed } from "@/lib/logger";

const MAX_QUERY_LENGTH = 2000;
const MAX_CONTEXT_CHARS = 12000;

interface ChunkResult {
  content: string;
  source_file: string;
  page_number: number;
  similarity: number;
  chunk_type: string;
}

// Rate limit: 20 requests per minute per IP
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 60_000;

export async function POST(req: NextRequest) {
  const requestStart = Date.now();

  try {
    // ── Rate limiting ─────────────────────────────────────────────────
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const { allowed, remaining, resetMs } = rateLimit(
      ip,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW
    );

    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait and try again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(resetMs / 1000)),
            "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const body = await req.json();

    // ── Runtime type validation ───────────────────────────────────────
    const query = typeof body.query === "string" ? body.query : "";
    const collection = typeof body.collection === "string" ? body.collection : "";
    const modelId = typeof body.model === "string" ? body.model : undefined;
    const streamMode = body.stream === true;

    if (!query || !collection) {
      return NextResponse.json(
        { error: "query and collection are required" },
        { status: 400 }
      );
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `Query too long (max ${MAX_QUERY_LENGTH} characters)` },
        { status: 400 }
      );
    }

    const col = COLLECTIONS.find((c) => c.id === collection);
    if (!col) {
      return NextResponse.json(
        { error: "Invalid collection" },
        { status: 400 }
      );
    }

    const selectedModel = modelId || DEFAULT_MODEL;
    if (!MODELS.find((m) => m.id === selectedModel)) {
      return NextResponse.json(
        { error: `Invalid model: ${selectedModel}` },
        { status: 400 }
      );
    }

    // ── Check response cache (non-streaming only) ─────────────────────
    const cacheKey = responseCacheKey(query, collection, selectedModel);

    if (!streamMode) {
      try {
        const cached = await getCachedResponse(cacheKey);
        if (cached) {
          logQuery({
            query_text: query,
            collection,
            model: selectedModel,
            provider: cached.provider,
            ip,
            total_ms: Date.now() - requestStart,
            input_tokens: cached.input_tokens,
            output_tokens: cached.output_tokens,
            chunk_count: cached.sources.length,
            cache_hit: true,
          });

          return NextResponse.json(
            {
              answer: cached.answer,
              sources: cached.sources,
              model: selectedModel,
              provider: cached.provider,
              latencyMs: Date.now() - requestStart,
              tokens: {
                input: cached.input_tokens,
                output: cached.output_tokens,
              },
              cached: true,
            },
            {
              headers: {
                "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
                "X-RateLimit-Remaining": String(remaining),
                "X-Cache": "HIT",
              },
            }
          );
        }
      } catch {
        // Cache miss or error — proceed normally
      }
    }

    // ── 1. Embed the query (with cache) ───────────────────────────────
    let embeddingCacheHit = false;
    const [queryEmbedding, embeddingMs] = await timed(async () => {
      // Try embedding cache first
      try {
        const cached = await getCachedEmbedding(query);
        if (cached) {
          embeddingCacheHit = true;
          return cached;
        }
      } catch {
        // Cache miss — proceed to OpenAI
      }

      const embedding = await getEmbedding(query);

      // Cache the new embedding (fire and forget)
      setCachedEmbedding(query, embedding).catch(() => {});

      return embedding;
    });

    // ── 2. Retrieve similar chunks ────────────────────────────────────
    const [{ chunks, error }, retrievalMs] = await timed(async () => {
      const supabase = getServiceClient();
      const { data: chunks, error } = await supabase.rpc(col.matchFn, {
        query_embedding: queryEmbedding,
        match_threshold: 0.3,
        match_count: 8,
      });
      return { chunks, error };
    });

    if (error) {
      console.error("Supabase RPC error:", error);
      logQuery({
        query_text: query,
        collection,
        model: selectedModel,
        ip,
        embedding_ms: embeddingMs,
        retrieval_ms: retrievalMs,
        total_ms: Date.now() - requestStart,
        error: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!chunks || chunks.length === 0) {
      logQuery({
        query_text: query,
        collection,
        model: selectedModel,
        ip,
        embedding_ms: embeddingMs,
        retrieval_ms: retrievalMs,
        total_ms: Date.now() - requestStart,
        chunk_count: 0,
      });
      return NextResponse.json({
        answer:
          "No relevant documents found for your query in this collection. Try rephrasing or selecting a different collection.",
        sources: [],
        model: selectedModel,
        provider: "",
        latencyMs: Date.now() - requestStart,
      });
    }

    // ── 3. Build context (with truncation) ────────────────────────────
    const typedChunks = chunks as ChunkResult[];
    let contextLength = 0;
    const usedChunks: ChunkResult[] = [];
    for (const c of typedChunks) {
      if (contextLength + c.content.length > MAX_CONTEXT_CHARS) break;
      usedChunks.push(c);
      contextLength += c.content.length;
    }

    const context = usedChunks
      .map(
        (c, i) =>
          `[Source ${i + 1}: ${c.source_file}, Page ${c.page_number}, Similarity: ${(c.similarity * 100).toFixed(1)}%]\n${c.content}`
      )
      .join("\n\n---\n\n");

    // ── 4. Prepare prompt ───────────────────────────────────────────────
    const systemPrompt = `You are a public investment management expert assistant. Answer the user's question based ONLY on the provided context from ${col.label}. Always cite your sources using [Source N] notation. If the context doesn't contain enough information, say so clearly.`;

    const userMessage = `Context:\n${context}\n\n---\n\nQuestion: ${query}`;

    const sources = usedChunks.map((c) => ({
      file: c.source_file,
      page: c.page_number,
      similarity: c.similarity,
      excerpt: c.content.substring(0, 200) + "...",
    }));

    // ── 5a. Streaming response (SSE) ──────────────────────────────────
    if (streamMode) {
      const llmStart = Date.now();
      const encoder = new TextEncoder();
      let fullAnswer = "";

      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Send sources first
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`)
            );

            let streamProvider = "";
            let streamInputTokens = 0;
            let streamOutputTokens = 0;

            // Stream LLM tokens
            for await (const event of generateAnswerStream(selectedModel, systemPrompt, userMessage, 2048)) {
              if (event.type === "text") {
                fullAnswer += event.content;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "text", content: event.content })}\n\n`)
                );
              } else if (event.type === "done") {
                streamProvider = event.provider ?? "";
                streamInputTokens = event.inputTokens ?? 0;
                streamOutputTokens = event.outputTokens ?? 0;
                const totalMs = Date.now() - requestStart;

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "done",
                      model: event.model,
                      provider: event.provider,
                      latencyMs: totalMs,
                      tokens: { input: event.inputTokens, output: event.outputTokens },
                      embeddingCached: embeddingCacheHit,
                    })}\n\n`
                  )
                );
              }
            }

            const llmMs = Date.now() - llmStart;
            const totalMs = Date.now() - requestStart;

            // Log the query
            logQuery({
              query_text: query,
              collection,
              model: selectedModel,
              provider: streamProvider,
              ip,
              embedding_ms: embeddingMs,
              retrieval_ms: retrievalMs,
              llm_ms: llmMs,
              total_ms: totalMs,
              input_tokens: streamInputTokens,
              output_tokens: streamOutputTokens,
              chunk_count: usedChunks.length,
              cache_hit: false,
            });

            // Cache the response (fire and forget)
            setCachedResponse(cacheKey, query, collection, selectedModel, {
              answer: fullAnswer,
              sources,
              provider: streamProvider,
              input_tokens: streamInputTokens,
              output_tokens: streamOutputTokens,
            }).catch(() => {});
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`)
            );
            logQuery({
              query_text: query,
              collection,
              model: selectedModel,
              ip,
              embedding_ms: embeddingMs,
              retrieval_ms: retrievalMs,
              total_ms: Date.now() - requestStart,
              chunk_count: usedChunks.length,
              error: msg,
            });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": String(remaining),
          "X-Cache": "MISS",
        },
      });
    }

    // ── 5b. Non-streaming response ────────────────────────────────────
    const [llmResponse, llmMs] = await timed(() =>
      generateAnswer(selectedModel, systemPrompt, userMessage, 2048)
    );

    const totalMs = Date.now() - requestStart;

    // Log the query
    logQuery({
      query_text: query,
      collection,
      model: selectedModel,
      provider: llmResponse.provider,
      ip,
      embedding_ms: embeddingMs,
      retrieval_ms: retrievalMs,
      llm_ms: llmMs,
      total_ms: totalMs,
      input_tokens: llmResponse.inputTokens,
      output_tokens: llmResponse.outputTokens,
      chunk_count: usedChunks.length,
      cache_hit: false,
    });

    // Cache the response (fire and forget)
    setCachedResponse(cacheKey, query, collection, selectedModel, {
      answer: llmResponse.text,
      sources,
      provider: llmResponse.provider,
      input_tokens: llmResponse.inputTokens ?? 0,
      output_tokens: llmResponse.outputTokens ?? 0,
    }).catch(() => {});

    return NextResponse.json(
      {
        answer: llmResponse.text,
        sources,
        model: llmResponse.model,
        provider: llmResponse.provider,
        latencyMs: totalMs,
        tokens: {
          input: llmResponse.inputTokens,
          output: llmResponse.outputTokens,
        },
        cached: false,
      },
      {
        headers: {
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": String(remaining),
          "X-Cache": "MISS",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Query API error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
