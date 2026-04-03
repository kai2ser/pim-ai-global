import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, COLLECTIONS, type CollectionName } from "@/lib/supabase";
import { getEmbedding } from "@/lib/embeddings";
import { generateAnswer, generateAnswerStream } from "@/lib/llm";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import { rateLimit } from "@/lib/rate-limit";

const MAX_QUERY_LENGTH = 2000;
const MAX_CONTEXT_CHARS = 12000;

// Rate limit: 20 requests per minute per IP
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 60_000;

export async function POST(req: NextRequest) {
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

    const { query, collection, model: modelId, stream: streamMode } = (await req.json()) as {
      query: string;
      collection: CollectionName;
      model?: string;
      stream?: boolean;
    };

    // ── Validation ────────────────────────────────────────────────────
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

    // ── 1. Embed the query ────────────────────────────────────────────
    const queryEmbedding = await getEmbedding(query);

    // ── 2. Retrieve similar chunks ────────────────────────────────────
    const supabase = getServiceClient();
    const { data: chunks, error } = await supabase.rpc(col.matchFn, {
      query_embedding: queryEmbedding,
      match_threshold: 0.3,
      match_count: 8,
    });

    if (error) {
      console.error("Supabase RPC error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        answer:
          "No relevant documents found for your query in this collection. Try rephrasing or selecting a different collection.",
        sources: [],
        model: selectedModel,
        provider: "",
        latencyMs: 0,
      });
    }

    // ── 3. Build context (with truncation) ────────────────────────────
    let contextLength = 0;
    const usedChunks: typeof chunks = [];
    for (const c of chunks) {
      if (contextLength + c.content.length > MAX_CONTEXT_CHARS) break;
      usedChunks.push(c);
      contextLength += c.content.length;
    }

    const context = usedChunks
      .map(
        (c: { content: string; source_file: string; page_number: number; similarity: number }, i: number) =>
          `[Source ${i + 1}: ${c.source_file}, Page ${c.page_number}, Similarity: ${(c.similarity * 100).toFixed(1)}%]\n${c.content}`
      )
      .join("\n\n---\n\n");

    // ── 4. Prepare prompt ───────────────────────────────────────────────
    const systemPrompt = `You are a public investment management expert assistant. Answer the user's question based ONLY on the provided context from ${col.label}. Always cite your sources using [Source N] notation. If the context doesn't contain enough information, say so clearly.`;

    const userMessage = `Context:\n${context}\n\n---\n\nQuestion: ${query}`;

    const sources = usedChunks.map(
      (c: { source_file: string; page_number: number; similarity: number; content: string }) => ({
        file: c.source_file,
        page: c.page_number,
        similarity: c.similarity,
        excerpt: c.content.substring(0, 200) + "...",
      })
    );

    // ── 5a. Streaming response (SSE) ──────────────────────────────────
    if (streamMode) {
      const start = Date.now();
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Send sources first
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`)
            );

            // Stream LLM tokens
            for await (const event of generateAnswerStream(selectedModel, systemPrompt, userMessage, 2048)) {
              if (event.type === "text") {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "text", content: event.content })}\n\n`)
                );
              } else if (event.type === "done") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "done",
                      model: event.model,
                      provider: event.provider,
                      latencyMs: Date.now() - start,
                      tokens: { input: event.inputTokens, output: event.outputTokens },
                    })}\n\n`
                  )
                );
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`)
            );
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
        },
      });
    }

    // ── 5b. Non-streaming response (legacy) ───────────────────────────
    const llmResponse = await generateAnswer(
      selectedModel,
      systemPrompt,
      userMessage,
      2048
    );

    return NextResponse.json(
      {
        answer: llmResponse.text,
        sources,
        model: llmResponse.model,
        provider: llmResponse.provider,
        latencyMs: llmResponse.latencyMs,
        tokens: {
          input: llmResponse.inputTokens,
          output: llmResponse.outputTokens,
        },
      },
      {
        headers: {
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": String(remaining),
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
