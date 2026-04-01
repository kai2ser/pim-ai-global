import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, COLLECTIONS, type CollectionName } from "@/lib/supabase";
import { getEmbedding } from "@/lib/embeddings";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  try {
    const { query, collection } = (await req.json()) as {
      query: string;
      collection: CollectionName;
    };

    if (!query || !collection) {
      return NextResponse.json(
        { error: "query and collection are required" },
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

    // 1. Embed the query
    const queryEmbedding = await getEmbedding(query);

    // 2. Retrieve similar chunks via Supabase RPC
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
      });
    }

    // 3. Build context from retrieved chunks
    const context = chunks
      .map(
        (c: { content: string; source_file: string; page_number: number; similarity: number }, i: number) =>
          `[Source ${i + 1}: ${c.source_file}, Page ${c.page_number}, Similarity: ${(c.similarity * 100).toFixed(1)}%]\n${c.content}`
      )
      .join("\n\n---\n\n");

    // 4. Generate answer with Claude
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing Anthropic API key in environment" }, { status: 500 });
    }
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: `You are a public investment management expert assistant. Answer the user's question based ONLY on the provided context from ${col.label}. Always cite your sources using [Source N] notation. If the context doesn't contain enough information, say so clearly.`,
      messages: [
        {
          role: "user",
          content: `Context:\n${context}\n\n---\n\nQuestion: ${query}`,
        },
      ],
    });

    const answer =
      message.content[0].type === "text" ? message.content[0].text : "";

    // 5. Return answer + sources
    const sources = chunks.map(
      (c: { source_file: string; page_number: number; similarity: number; content: string }) => ({
        file: c.source_file,
        page: c.page_number,
        similarity: c.similarity,
        excerpt: c.content.substring(0, 200) + "...",
      })
    );

    return NextResponse.json({ answer, sources });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("Query API error:", message, stack);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
