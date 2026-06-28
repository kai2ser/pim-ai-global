"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { COLLECTIONS, type CollectionName } from "@/lib/supabase";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import MarkdownRenderer from "@/components/markdown-renderer";
import { Send, Loader2, FileText, ChevronDown, Clock, Cpu, Copy, Check, History, Trash2, Download } from "lucide-react";

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

interface HistoryEntry {
  query: string;
  collection: CollectionName;
  model: string;
  timestamp: number;
}

const HISTORY_KEY = "pim-ai-query-history";
const MAX_HISTORY = 20;

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // localStorage unavailable
  }
}

export default function QueryPage() {
  const [collection, setCollection] = useState<CollectionName>("pim_literature");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [latestOnly, setLatestOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [meta, setMeta] = useState<QueryMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const addToHistory = useCallback((q: string, col: CollectionName, mod: string) => {
    const entry: HistoryEntry = { query: q, collection: col, model: mod, timestamp: Date.now() };
    const updated = [entry, ...loadHistory().filter((h) => h.query !== q)].slice(0, MAX_HISTORY);
    saveHistory(updated);
    setHistory(updated);
  }, []);

  const clearHistory = useCallback(() => {
    saveHistory([]);
    setHistory([]);
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadDoc = useCallback(async () => {
    setDownloadError("");
    try {
    const collectionLabel =
      COLLECTIONS.find((c) => c.id === collection)?.label ?? collection;
    const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;
    const askedAt = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";

    // Reuse the answer HTML already rendered on screen by <MarkdownRenderer>
    // (grabbed via answerRef). This is the most robust source — no extra
    // markdown library to load at click time (an earlier marked-based
    // approach failed in the browser), and the document matches exactly what
    // the user sees. Fall back to a minimal markdown→HTML conversion if the
    // ref isn't available for any reason.
    const escForFallback = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const answerHtml =
      answerRef.current?.innerHTML ||
      `<pre style="white-space:pre-wrap;font-family:Calibri,Arial,sans-serif;">${escForFallback(answer)}</pre>`;

    // Escape arbitrary text for safe HTML embedding (user-typed query + source
    // excerpts/filenames that came back from the API).
    const esc = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const sourcesHtml = sources.length
      ? `<h2>Sources (${sources.length})</h2><ol>${sources
          .map(
            (s) => `<li style="margin-bottom:8pt;">
              <strong>${esc(s.file)}</strong> — page ${s.page}
              · ${(s.similarity * 100).toFixed(1)}% match<br/>
              <span style="color:#555;font-size:10pt;">${esc(s.excerpt)}</span>
            </li>`
          )
          .join("")}</ol>`
      : "";

    // Word opens HTML when served with application/msword. Wrapping in a
    // full <html> with the Office XML namespace plus a few Word-friendly
    // styles gives a more "document-like" result than a bare HTML blob.
    const docHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8"/>
  <title>PIM-PAM Query Result</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1d212b; }
    h1 { font-size: 18pt; color: #374696; margin-bottom: 4pt; }
    h2 { font-size: 14pt; color: #374696; margin-top: 18pt; }
    h3 { font-size: 12pt; color: #374696; }
    .meta { color: #555; font-size: 10pt; margin-bottom: 12pt; }
    .meta div { margin: 2pt 0; }
    blockquote { border-left: 3pt solid #4472c4; padding-left: 10pt; color: #555; }
    code { font-family: Consolas, monospace; background: #f0f5ff; padding: 1pt 3pt; }
    pre { background: #f0f5ff; padding: 8pt; font-family: Consolas, monospace; font-size: 10pt; }
    hr { border: none; border-top: 1pt solid #dce4f0; margin: 18pt 0; }
    footer { color: #888; font-size: 9pt; margin-top: 24pt; }
  </style>
</head>
<body>
  <h1>PIM-PAM query result</h1>
  <div class="meta">
    <div><strong>Question:</strong> ${esc(query)}</div>
    <div><strong>Collection:</strong> ${esc(collectionLabel)}</div>
    <div><strong>Model:</strong> ${esc(modelLabel)}</div>
    <div><strong>Generated:</strong> ${askedAt}</div>
  </div>
  <hr/>
  <h2>Answer</h2>
  ${answerHtml}
  ${sourcesHtml}
  <hr/>
  <footer>
    Generated by PIM-PAM (https://pim-ai-global.vercel.app). Citations link
    to passages retrieved from the document collection at query time —
    verify against the underlying reports before use.
  </footer>
</body>
</html>`;

    const blob = new Blob([docHtml], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    // Filename — sortable timestamp + first few words of the query (kebab-
    // cased) so downloads don't all look the same in the user's folder.
    const slug = query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const filename = `pim-pam-${ts}${slug ? "-" + slug : ""}.doc`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    // Defer cleanup. Revoking the object URL (or removing the anchor)
    // synchronously right after click() races the browser's download and
    // can cancel it silently — this was the "button does nothing" bug.
    // Giving the download a moment to start before revoking fixes it.
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 4000);
    } catch (err) {
      console.error("Word download failed:", err);
      const detail = err instanceof Error ? err.message : String(err);
      setDownloadError(
        `Could not generate the Word document (${detail}). Please try again, or use Copy to paste the answer elsewhere.`
      );
    }
  }, [answer, collection, model, query, sources]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError("");
    setAnswer("");
    setSources([]);
    setMeta(null);
    setCopied(false);

    addToHistory(query.trim(), collection, model);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          collection,
          model,
          stream: true,
          latest_only: latestOnly,
        }),
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

      {/* Query History */}
      {history.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-sm font-medium text-[#4472c4] hover:text-[#374696]"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            Recent queries ({history.length})
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showHistory ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          {showHistory && (
            <div className="mt-2 rounded-lg border border-[#dce4f0] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#dce4f0] px-4 py-2">
                <span className="text-xs font-medium text-[#778899]">Query History</span>
                <button
                  onClick={clearHistory}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Clear
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuery(h.query);
                      setCollection(h.collection);
                      setModel(h.model);
                      setShowHistory(false);
                    }}
                    className="flex w-full items-start gap-3 border-b border-[#dce4f0] px-4 py-2.5 text-left last:border-b-0 hover:bg-[#f0f5ff]/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[#1d212b]">{h.query}</p>
                      <p className="mt-0.5 text-xs text-[#778899]">
                        {COLLECTIONS.find((c) => c.id === h.collection)?.label} &middot;{" "}
                        {new Date(h.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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

        {/* Scope toggle: latest report per (country, category) only */}
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-[#1d212b]">
          <input
            type="checkbox"
            checked={latestOnly}
            onChange={(e) => setLatestOnly(e.target.checked)}
            className="h-4 w-4 rounded border-[#dce4f0] text-[#4472c4] focus:ring-[#4472c4]"
            aria-describedby="latest-only-desc"
          />
          <span>Latest reports only</span>
          <span id="latest-only-desc" className="text-xs text-[#778899]">
            — restrict retrieval to the most recent report per country and category
          </span>
        </label>

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
            {/* Answer header with model badge + copy button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="font-heading text-lg font-semibold text-[#1d212b]">
                  Answer
                </h2>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 rounded-md border border-[#dce4f0] px-2 py-1 text-xs text-[#778899] transition-colors hover:border-[#4472c4] hover:text-[#4472c4]"
                  aria-label="Copy answer to clipboard"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      Copy
                    </>
                  )}
                </button>
                <button
                  onClick={handleDownloadDoc}
                  className="flex items-center gap-1 rounded-md border border-[#dce4f0] px-2 py-1 text-xs text-[#778899] transition-colors hover:border-[#4472c4] hover:text-[#4472c4]"
                  aria-label="Download answer as Word document"
                  title="Download as Word document (.doc)"
                >
                  <Download className="h-3 w-3" aria-hidden="true" />
                  Word
                </button>
              </div>
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
            <div ref={answerRef} className="mt-3 text-sm leading-relaxed">
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

          {/* Bottom action bar — repeat the download here so it's at hand
              after the user has scrolled through the answer + sources. */}
          <div className="border-t border-[#dce4f0] pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#778899]">
                Save this result as a Word document for sharing or archiving.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadDoc}
                aria-label="Download answer as Word document"
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Download as Word
              </Button>
            </div>
            {downloadError && (
              <p className="mt-2 text-xs text-red-600" role="alert">
                {downloadError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
