import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, COLLECTIONS, type CollectionName } from "@/lib/supabase";
import { getEmbedding } from "@/lib/embeddings";
import { generateAnswer } from "@/lib/llm";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";

const MAX_QUERY_LENGTH = 2000;
const MAX_CONTEXT_CHARS = 12000;

export async function POST(req: NextRequest) {
  try {
    const { query, collection, model: modelId } = (await req.json()) as {
      query: string;
      collection: CollectionName;
      model?: string;
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

    // ── 4. Generate answer via LLM Router ─────────────────────────────
    const systemPrompt = `You are a public investment management expert assistant. Answer the user's question based ONLY on the provided context from ${col.label}. Always cite your sources using [Source N] notation. If the context doesn't contain enough information, say so clearly.`;

    const userMessage = `Context:\n${context}\n\n---\n\nQuestion: ${query}`;

    const llmResponse = await generateAnswer(
      selectedModel,
      systemPrompt,
      userMessage,
      2048
    );

    // ── 5. Return answer + sources + metadata ─────────────────────────
    const sources = usedChunks.map(
      (c: { source_file: string; page_number: number; similarity: number; content: string }) => ({
        file: c.source_file,
        page: c.page_number,
        similarity: c.similarity,
        excerpt: c.content.substring(0, 200) + "...",
      })
    );

    return NextResponse.json({
      answer: llmResponse.text,
      sources,
      model: llmResponse.model,
      provider: llmResponse.provider,
      latencyMs: llmResponse.latencyMs,
      tokens: {
        input: llmResponse.inputTokens,
        output: llmResponse.outputTokens,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Query API error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
