"use client";

import { useEffect, useState } from "react";
import { Database, FileText, Image, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CollectionStat {
  collection_name: string;
  total_chunks: number;
  text_chunks: number;
  image_chunks: number;
  unique_documents: number;
  avg_content_length: number;
}

export default function StatisticsPage() {
  const [stats, setStats] = useState<CollectionStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStats = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load stats");
        return;
      }
      setStats(data.stats || []);
    } catch {
      setError("Failed to connect to the server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const totals = stats.reduce(
    (acc, s) => ({
      total_chunks: acc.total_chunks + (s.total_chunks || 0),
      text_chunks: acc.text_chunks + (s.text_chunks || 0),
      image_chunks: acc.image_chunks + (s.image_chunks || 0),
      unique_documents: acc.unique_documents + (s.unique_documents || 0),
    }),
    { total_chunks: 0, text_chunks: 0, image_chunks: 0, unique_documents: 0 }
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-start justify-between">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
            Vector Database Analytics
          </p>
          <h1 className="font-heading text-3xl font-bold text-[#1d212b] md:text-4xl">
            Collection Statistics
          </h1>
          <p className="mt-3 max-w-2xl text-[#778899]">
            Real-time overview of the three document collections stored in Supabase
            pgvector. Embedding model: OpenAI text-embedding-3-small (1536 dimensions).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchStats}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && (
        <div className="mt-16 flex items-center justify-center gap-3 text-[#778899]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading statistics...
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary cards */}
          <div className="mt-10 grid gap-4 sm:grid-cols-4">
            {[
              {
                label: "Total Chunks",
                value: totals.total_chunks.toLocaleString(),
                icon: Database,
              },
              {
                label: "Text Chunks",
                value: totals.text_chunks.toLocaleString(),
                icon: FileText,
              },
              {
                label: "Image Chunks",
                value: totals.image_chunks.toLocaleString(),
                icon: Image,
              },
              {
                label: "Unique Documents",
                value: totals.unique_documents.toLocaleString(),
                icon: FileText,
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-[#dce4f0] bg-white p-5 shadow-sm"
              >
                <card.icon className="mb-2 h-5 w-5 text-[#4472c4]" />
                <p className="text-2xl font-bold text-[#1d212b]">{card.value}</p>
                <p className="mt-1 text-xs text-[#778899]">{card.label}</p>
              </div>
            ))}
          </div>

          {/* Detailed table */}
          <div className="mt-10 overflow-hidden rounded-lg border border-[#dce4f0] bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#dce4f0] bg-[#f0f5ff]/50">
                  <th className="px-4 py-3 text-left font-semibold text-[#1d212b]">
                    Collection
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-[#1d212b]">
                    Total Chunks
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-[#1d212b]">
                    Text
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-[#1d212b]">
                    Images
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-[#1d212b]">
                    Documents
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-[#1d212b]">
                    Avg Chunk Length
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => (
                  <tr
                    key={s.collection_name}
                    className={
                      i < stats.length - 1 ? "border-b border-[#dce4f0]" : ""
                    }
                  >
                    <td className="px-4 py-3 font-medium text-[#1d212b]">
                      {s.collection_name}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#1d212b]">
                      {(s.total_chunks || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#778899]">
                      {(s.text_chunks || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#778899]">
                      {(s.image_chunks || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#778899]">
                      {(s.unique_documents || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#778899]">
                      {s.avg_content_length
                        ? `${Number(s.avg_content_length).toLocaleString()} chars`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tech specs */}
          <div className="mt-10 rounded-lg border border-[#dce4f0] bg-[#f0f5ff]/50 p-6">
            <h3 className="font-heading text-base font-semibold text-[#1d212b]">
              Technical Specifications
            </h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { dt: "Embedding Model", dd: "OpenAI text-embedding-3-small" },
                { dt: "Vector Dimensions", dd: "1,536" },
                { dt: "Vector Database", dd: "Supabase pgvector" },
                { dt: "Distance Metric", dd: "Cosine similarity" },
                { dt: "Index Type", dd: "IVFFlat (100 lists)" },
                { dt: "LLM for Answers", dd: "Claude 3.5 Sonnet" },
                { dt: "Chunk Strategy", dd: "1,000 chars / 200 overlap" },
                { dt: "File Formats", dd: "PDF, DOCX, TXT" },
              ].map((item) => (
                <div key={item.dt}>
                  <dt className="text-xs font-medium text-[#778899]">
                    {item.dt}
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-[#1d212b]">
                    {item.dd}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </div>
  );
}
