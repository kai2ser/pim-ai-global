"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  Clock,
  Zap,
  Database,
  AlertTriangle,
  Activity,
  Cpu,
} from "lucide-react";

interface LogEntry {
  id: number;
  query_text: string;
  collection: string;
  model: string;
  provider: string;
  embedding_ms: number | null;
  retrieval_ms: number | null;
  llm_ms: number | null;
  total_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  chunk_count: number | null;
  cache_hit: boolean;
  error: string | null;
  created_at: string;
}

interface Summary {
  total_queries: number;
  avg_total_ms: number;
  avg_embedding_ms: number;
  avg_retrieval_ms: number;
  avg_llm_ms: number;
  cache_hits: number;
  errors: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface CacheStats {
  embedding_cache_entries: number;
  response_cache_entries: number;
}

interface AnalyticsData {
  recent: LogEntry[];
  summary_24h: Summary;
  cache: CacheStats;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAnalytics = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/analytics");
      if (!res.ok) {
        setError(`Server error: ${res.status}`);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Analytics fetch error:", err);
      setError("Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const s = data?.summary_24h;
  const c = data?.cache;
  const cacheHitRate =
    s && s.total_queries > 0
      ? ((s.cache_hits / s.total_queries) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-start justify-between">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
            Observability
          </p>
          <h1 className="font-heading text-3xl font-bold text-[#1d212b] md:text-4xl">
            Query Analytics
          </h1>
          <p className="mt-3 max-w-2xl text-[#778899]">
            Performance metrics, cache hit rates, and usage patterns for the last
            24 hours.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAnalytics}
          disabled={loading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {loading && (
        <div className="mt-16 flex items-center justify-center gap-3 text-[#778899]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading analytics...
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Summary Cards */}
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: "Queries (24h)",
                value: s?.total_queries ?? 0,
                icon: Activity,
              },
              {
                label: "Avg Latency",
                value: s?.avg_total_ms ? `${(s.avg_total_ms / 1000).toFixed(1)}s` : "—",
                icon: Clock,
              },
              {
                label: "Cache Hit Rate",
                value: `${cacheHitRate}%`,
                icon: Zap,
              },
              {
                label: "Errors",
                value: s?.errors ?? 0,
                icon: AlertTriangle,
                alert: (s?.errors ?? 0) > 0,
              },
            ].map((card) => (
              <div
                key={card.label}
                className={`rounded-lg border p-5 shadow-sm ${
                  "alert" in card && card.alert
                    ? "border-red-200 bg-red-50"
                    : "border-[#dce4f0] bg-white"
                }`}
              >
                <card.icon
                  className={`mb-2 h-5 w-5 ${
                    "alert" in card && card.alert
                      ? "text-red-500"
                      : "text-[#4472c4]"
                  }`}
                />
                <p className="text-2xl font-bold text-[#1d212b]">
                  {card.value}
                </p>
                <p className="mt-1 text-xs text-[#778899]">{card.label}</p>
              </div>
            ))}
          </div>

          {/* Latency Breakdown + Cache + Token Usage */}
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {/* Latency breakdown */}
            <div className="rounded-lg border border-[#dce4f0] bg-white p-5 shadow-sm">
              <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-[#1d212b]">
                <Clock className="h-4 w-4 text-[#4472c4]" />
                Avg Latency Breakdown
              </h3>
              <div className="mt-4 space-y-3">
                {[
                  { label: "Embedding", ms: s?.avg_embedding_ms ?? 0, color: "bg-blue-400" },
                  { label: "Retrieval", ms: s?.avg_retrieval_ms ?? 0, color: "bg-teal-400" },
                  { label: "LLM Generation", ms: s?.avg_llm_ms ?? 0, color: "bg-purple-400" },
                ].map((bar) => {
                  const total = s?.avg_total_ms || 1;
                  const pct = Math.min(100, (bar.ms / total) * 100);
                  return (
                    <div key={bar.label}>
                      <div className="flex justify-between text-xs text-[#778899]">
                        <span>{bar.label}</span>
                        <span>{bar.ms}ms</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-[#f0f5ff]">
                        <div
                          className={`h-2 rounded-full ${bar.color}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="border-t border-[#dce4f0] pt-2 text-right text-xs font-medium text-[#1d212b]">
                  Total: {s?.avg_total_ms ?? 0}ms
                </div>
              </div>
            </div>

            {/* Cache stats */}
            <div className="rounded-lg border border-[#dce4f0] bg-white p-5 shadow-sm">
              <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-[#1d212b]">
                <Database className="h-4 w-4 text-[#4472c4]" />
                Cache
              </h3>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs text-[#778899]">Embedding Cache</p>
                  <p className="text-lg font-bold text-[#1d212b]">
                    {c?.embedding_cache_entries ?? 0}{" "}
                    <span className="text-sm font-normal text-[#778899]">entries</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#778899]">Response Cache</p>
                  <p className="text-lg font-bold text-[#1d212b]">
                    {c?.response_cache_entries ?? 0}{" "}
                    <span className="text-sm font-normal text-[#778899]">entries</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#778899]">Cache Hits (24h)</p>
                  <p className="text-lg font-bold text-[#1d212b]">
                    {s?.cache_hits ?? 0}{" "}
                    <span className="text-sm font-normal text-[#778899]">
                      of {s?.total_queries ?? 0} queries
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Token usage */}
            <div className="rounded-lg border border-[#dce4f0] bg-white p-5 shadow-sm">
              <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-[#1d212b]">
                <Cpu className="h-4 w-4 text-[#4472c4]" />
                Token Usage (24h)
              </h3>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs text-[#778899]">Input Tokens</p>
                  <p className="text-lg font-bold text-[#1d212b]">
                    {(s?.total_input_tokens ?? 0).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#778899]">Output Tokens</p>
                  <p className="text-lg font-bold text-[#1d212b]">
                    {(s?.total_output_tokens ?? 0).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#778899]">Total</p>
                  <p className="text-lg font-bold text-[#1d212b]">
                    {(
                      (s?.total_input_tokens ?? 0) +
                      (s?.total_output_tokens ?? 0)
                    ).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Queries Table */}
          <div className="mt-10">
            <h3 className="font-heading text-base font-semibold text-[#1d212b]">
              Recent Queries
            </h3>
            {data.recent.length === 0 ? (
              <p className="mt-4 text-sm text-[#778899]">
                No queries logged yet. Submit a query to see analytics here.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-[#dce4f0] bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#dce4f0] bg-[#f0f5ff]/50">
                      <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-[#1d212b]">
                        Query
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-[#1d212b]">
                        Collection
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-[#1d212b]">
                        Model
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-[#1d212b]">
                        Total
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-[#1d212b]">
                        Embed
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-[#1d212b]">
                        Search
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-[#1d212b]">
                        LLM
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-semibold text-[#1d212b]">
                        Cache
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-[#1d212b]">
                        Tokens
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-[#1d212b]">
                        Time
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((log) => (
                      <tr
                        key={log.id}
                        className={`border-b border-[#dce4f0] last:border-b-0 ${
                          log.error ? "bg-red-50/50" : ""
                        }`}
                      >
                        <td
                          className="max-w-[200px] truncate px-3 py-2 text-[#1d212b]"
                          title={log.query_text}
                        >
                          {log.query_text}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-[#778899]">
                          {log.collection}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-[#778899]">
                          {log.model}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#1d212b]">
                          {log.total_ms ? `${(log.total_ms / 1000).toFixed(1)}s` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#778899]">
                          {log.embedding_ms ?? "—"}ms
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#778899]">
                          {log.retrieval_ms ?? "—"}ms
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#778899]">
                          {log.llm_ms ? `${(log.llm_ms / 1000).toFixed(1)}s` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center">
                          {log.cache_hit ? (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                              HIT
                            </span>
                          ) : (
                            <span className="text-xs text-[#b0b8c4]">MISS</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#778899]">
                          {(log.input_tokens ?? 0) + (log.output_tokens ?? 0)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-[#778899]">
                          {new Date(log.created_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
