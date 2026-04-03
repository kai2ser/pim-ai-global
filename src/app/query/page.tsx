"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { COLLECTIONS, type CollectionName } from "@/lib/supabase";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import MarkdownRenderer from "@/components/markdown-renderer";
import { Send, Loader2, FileText, ChevronDown, Clock, Cpu } from "lucide-react";

interface Source {
  file: string;
  page: number;
  similarity: number;
  excerpt: string;
}

interface QueryMeta {
  model: string;
  provider: string;
  latencyMs: number;
  tokens?: { input?: number; output?: number };
}

export default function QueryPage() {
  const [collection, setCollection] = useState<CollectionName>("pim_literature");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError("");
    setAnswer("");
    setSources([]);
    setMeta(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), collection, model, stream: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Something went wrong");
        return;
      }

      // ── Stream SSE response ──────────────────────────────────────────
      const reader = res.body?.getReader();
      if (!reader) {
        setError("Streaming not supported");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "sources") {
              setSources(event.sources || []);
            } else if (event.type === "text") {
              setAnswer((prev) => prev + event.content);
            } else if (event.type === "done") {
              setMeta({
                model: event.model || model,
                provider: event.provider || "",
                latencyMs: event.latencyMs || 0,
                tokens: event.tokens,
              });
            } else if (event.type === "error") {
              setError(event.error);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      console.error("Query submission error:", err);
      setError("Failed to connect to the server");
    } finally {
      setLoading(false);
    }
  };

  // Keyboard shortcut: Cmd/Ctrl + Enter to submit
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  const selectedCol = COLLECTIONS.find((c) => c.id === collection) ?? COLLECTIONS[0];
  const selectedModel = MODELS.find((m) => m.id === model) ?? MODELS[0];

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      {/* Header */}
      <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
        RAG Query Interface
      </p>
      <h1 className="font-heading text-3xl font-bold text-[#1d212b] md:text-4xl">
        Search Document Collections
      </h1>
      <p className="mt-3 max-w-2xl text-[#778899]">
        Select a document collection, choose an AI model, and submit your
        question. The system will retrieve relevant passages and generate an
        AI-powered answer with source citations.
      </p>

      {/* Query Form */}
      <form ref={formRef} onSubmit={handleSubmit} className="mt-8 space-y-4">
        {/* Row: Collection + Model selectors */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Collection selector */}
          <div>
            <label
              htmlFor="collection-select"
              className="mb-2 block text-sm font-medium text-[#1d212b]"
            >
              Document Collection
            </label>
            <div className="relative">
              <select
                id="collection-select"
                aria-label="Select document collection"
                aria-describedby="collection-desc"
                value={collection}
                onChange={(e) => setCollection(e.target.value as CollectionName)}
                className="w-full appearance-none rounded-lg border border-[#dce4f0] bg-white px-4 py-3 pr-10 text-sm text-[#1d212b] shadow-sm focus:border-[#4472c4] focus:outline-none focus:ring-2 focus:ring-[#4472c4]/20"
              >
                {COLLECTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#778899]" aria-hidden="true" />
            </div>
            <p id="collection-desc" className="mt-1 text-xs text-[#778899]">
              {selectedCol.description}
            </p>
          </div>

          {/* Model selector */}
          <div>
            <label
              htmlFor="model-select"
              className="mb-2 block text-sm font-medium text-[#1d212b]"
            >
              AI Model
            </label>
            <div className="relative">
              <select
                id="model-select"
                aria-label="Select AI model"
                aria-describedby="model-desc"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full appearance-none rounded-lg border border-[#dce4f0] bg-white px-4 py-3 pr-10 text-sm text-[#1d212b] shadow-sm focus:border-[#4472c4] focus:outline-none focus:ring-2 focus:ring-[#4472c4]/20"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.provider})
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#778899]" aria-hidden="true" />
            </div>
            <p id="model-desc" className="mt-1 text-xs text-[#778899]">
              {selectedModel.description}
            </p>
          </div>
        </div>

        {/* Query input */}
        <div>
          <label
            htmlFor="query-input"
            className="mb-2 block text-sm font-medium text-[#1d212b]"
          >
            Your Question
          </label>
          <div className="relative">
            <textarea
              id="query-input"
              aria-label="Enter your question"
              aria-describedby="query-hint"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., What are the best practices for climate-smart public investment management?"
              rows={3}
              maxLength={2000}
              className="w-full rounded-lg border border-[#dce4f0] bg-white px-4 py-3 text-sm text-[#1d212b] shadow-sm placeholder:text-[#b0b8c4] focus:border-[#4472c4] focus:outline-none focus:ring-2 focus:ring-[#4472c4]/20"
            />
            <span id="query-hint" className="absolute bottom-2 right-3 text-xs text-[#b0b8c4]">
              {query.length}/2000 &middot; {navigator?.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to submit
            </span>
          </div>
        </div>

        <Button type="submit" disabled={loading || !query.trim()} size="lg">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              <span role="status">Searching &amp; Generating...</span>
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              Submit Query
            </>
          )}
        </Button>
      </form>

      {/* Error */}
      {error && (
        <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Answer */}
      {answer && (
        <div className="mt-8 space-y-6" aria-live="polite">
          <div
            role="region"
            aria-label="AI-generated answer"
            className="rounded-lg border border-[#dce4f0] bg-white p-6 shadow-sm"
          >
            {/* Answer header with model badge */}
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-lg font-semibold text-[#1d212b]">
                Answer
              </h2>
              {meta && (
                <div className="flex items-center gap-3 text-xs text-[#778899]">
                  <span className="flex items-center gap-1">
                    <Cpu className="h-3 w-3" aria-hidden="true" />
                    {meta.model}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {(meta.latencyMs / 1000).toFixed(1)}s
                  </span>
                  {meta.tokens?.input && meta.tokens?.output && (
                    <span>
                      {meta.tokens.input + meta.tokens.output} tokens
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 text-sm leading-relaxed">
              <MarkdownRenderer content={answer} />
            </div>
          </div>

          {/* Sources */}
          {sources.length > 0 && (
            <div role="region" aria-label="Source documents">
              <h3 className="font-heading text-base font-semibold text-[#1d212b]">
                Sources ({sources.length})
              </h3>
              <div className="mt-3 space-y-3">
                {sources.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-[#dce4f0] bg-[#f0f5ff]/50 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#4472c4]" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1d212b]">
                          {s.file}
                          <span className="ml-2 text-xs text-[#778899]">
                            Page {s.page} &middot;{" "}
                            {(s.similarity * 100).toFixed(1)}% match
                          </span>
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-[#778899]">
                          {s.excerpt}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
