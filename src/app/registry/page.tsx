"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { COLLECTIONS, type CollectionName } from "@/lib/supabase";
import {
  Loader2,
  Filter,
  X,
  ExternalLink,
  CheckCircle2,
  Circle,
  AlertCircle,
} from "lucide-react";

interface DocumentRow {
  id: string;
  filename: string;
  country: string | null;
  year: number | null;
  tags: Record<string, string | boolean>;
  ingestion_status: string;
  chunk_count: number;
  source_url: string | null;
}

interface TagClass {
  tag_key: string;
  display_label: string;
  allowed_values: string[];
  ordering: number;
}

interface CountrySummary {
  country: string;
  total: number;
  embedded: number;
  latest_year: number | null;
}

interface RegistryData {
  collection: { id: CollectionName; label: string; description: string };
  tag_classes: TagClass[];
  country_summary: CountrySummary[];
  documents: DocumentRow[];
  pagination: { page: number; page_size: number; total_count: number };
}

const STATUS_LABEL: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  embedded: { label: "Embedded", icon: CheckCircle2, color: "text-emerald-600" },
  downloaded: { label: "Downloaded", icon: Circle, color: "text-amber-600" },
  catalogued: { label: "Catalogued", icon: Circle, color: "text-slate-400" },
  failed: { label: "Failed", icon: AlertCircle, color: "text-red-600" },
};

export default function RegistryPage() {
  const [collection, setCollection] = useState<CollectionName>(COLLECTIONS[0].id);
  const [latestOnly, setLatestOnly] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<Record<string, string>>({});
  const [data, setData] = useState<RegistryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchRegistry = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ collection });
    if (selectedCountry) params.set("country", selectedCountry);
    if (latestOnly) params.set("latest_only", "true");
    for (const [k, v] of Object.entries(activeTags)) {
      if (v) params.append("tag", `${k}:${v}`);
    }
    try {
      const res = await fetch(`/api/registry?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Server error: ${res.status}`);
        return;
      }
      const json: RegistryData = await res.json();
      setData(json);
    } catch (err) {
      console.error("Registry fetch error:", err);
      setError("Failed to load registry");
    } finally {
      setLoading(false);
    }
  }, [collection, selectedCountry, latestOnly, activeTags]);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  // Reset country + tag filters when switching collections (different filter
  // chip schemas — keeping stale filters would 0-result the new collection).
  const switchCollection = (id: CollectionName) => {
    setCollection(id);
    setSelectedCountry(null);
    setActiveTags({});
  };

  const clearFilters = () => {
    setSelectedCountry(null);
    setActiveTags({});
    setLatestOnly(false);
  };

  const filterCount =
    (selectedCountry ? 1 : 0) + Object.values(activeTags).filter(Boolean).length + (latestOnly ? 1 : 0);

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      {/* Header */}
      <div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
          Document Registry
        </p>
        <h1 className="font-heading text-3xl font-bold text-[#1d212b] md:text-4xl">
          Registry
        </h1>
        <p className="mt-3 max-w-3xl text-[#778899]">
          Browse every catalogued report across the four collections. Filter by
          country and report type; click into a country to see its full report
          history.
        </p>
      </div>

      {/* Collection tabs */}
      <div className="mt-8 flex flex-wrap gap-2 border-b border-[#dce4f0]">
        {COLLECTIONS.map((c) => (
          <button
            key={c.id}
            onClick={() => switchCollection(c.id)}
            className={`relative px-4 py-2 text-sm font-medium transition-colors ${
              collection === c.id
                ? "text-[#4472c4]"
                : "text-[#778899] hover:text-[#1d212b]"
            }`}
          >
            {c.label}
            {collection === c.id && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[#4472c4]" />
            )}
          </button>
        ))}
      </div>

      {loading && !data && (
        <div className="mt-16 flex items-center justify-center gap-3 text-[#778899]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading registry...
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

      {data && (
        <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
          {/* ── Left rail: filters + country list ─────────────────────────── */}
          <aside className="space-y-6">
            {/* Filter chips */}
            {data.tag_classes.length > 0 && (
              <div>
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#778899]">
                  <Filter className="h-3.5 w-3.5" />
                  Filters
                </h2>
                {data.tag_classes.map((tc) => (
                  <div key={tc.tag_key} className="mt-3">
                    <p className="mb-1.5 text-xs text-[#778899]">{tc.display_label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {tc.allowed_values.map((v) => {
                        const active = activeTags[tc.tag_key] === v;
                        return (
                          <button
                            key={v}
                            onClick={() =>
                              setActiveTags((prev) => ({
                                ...prev,
                                [tc.tag_key]: active ? "" : v,
                              }))
                            }
                            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                              active
                                ? "border-[#4472c4] bg-[#4472c4] text-white"
                                : "border-[#dce4f0] text-[#1d212b] hover:border-[#4472c4]"
                            }`}
                          >
                            {v}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Latest-only toggle */}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[#1d212b]">
              <input
                type="checkbox"
                checked={latestOnly}
                onChange={(e) => setLatestOnly(e.target.checked)}
                className="h-4 w-4 rounded border-[#dce4f0] text-[#4472c4]"
              />
              Latest report per country/type only
            </label>

            {filterCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <X className="mr-1.5 h-3 w-3" />
                Clear {filterCount} filter{filterCount > 1 ? "s" : ""}
              </Button>
            )}

            {/* Country list */}
            {data.country_summary.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#778899]">
                  Country ({data.country_summary.length})
                </h2>
                <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-[#dce4f0]">
                  <button
                    onClick={() => setSelectedCountry(null)}
                    className={`block w-full px-3 py-1.5 text-left text-xs ${
                      !selectedCountry
                        ? "bg-[#f0f5ff] font-medium text-[#4472c4]"
                        : "text-[#1d212b] hover:bg-[#f8fafc]"
                    }`}
                  >
                    All countries
                  </button>
                  {data.country_summary.map((c) => (
                    <button
                      key={c.country}
                      onClick={() =>
                        setSelectedCountry(selectedCountry === c.country ? null : c.country)
                      }
                      className={`flex w-full items-center justify-between border-t border-[#dce4f0] px-3 py-1.5 text-left text-xs ${
                        selectedCountry === c.country
                          ? "bg-[#f0f5ff] font-medium text-[#4472c4]"
                          : "text-[#1d212b] hover:bg-[#f8fafc]"
                      }`}
                    >
                      <span>{c.country}</span>
                      <span className="text-[#778899]">{c.total}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* ── Main: document table ──────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#778899]">
                {data.pagination.total_count.toLocaleString()} report
                {data.pagination.total_count !== 1 ? "s" : ""} in {data.collection.label}
                {selectedCountry && ` • ${selectedCountry}`}
              </p>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-[#778899]" />}
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-[#dce4f0] bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-[#dce4f0] bg-[#f8fafc] text-xs uppercase tracking-wider text-[#778899]">
                  <tr>
                    <th className="px-4 py-2 text-left">Country</th>
                    <th className="px-4 py-2 text-left">Year</th>
                    <th className="px-4 py-2 text-left">Document</th>
                    <th className="px-4 py-2 text-left">Tags</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-right">Chunks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.documents.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-[#778899]">
                        No documents match these filters.
                      </td>
                    </tr>
                  )}
                  {data.documents.map((d) => {
                    const statusMeta = STATUS_LABEL[d.ingestion_status] ?? {
                      label: d.ingestion_status,
                      icon: Circle,
                      color: "text-slate-400",
                    };
                    const StatusIcon = statusMeta.icon;
                    return (
                      <tr
                        key={d.id}
                        className="border-b border-[#f0f5ff] last:border-0 hover:bg-[#f8fafc]"
                      >
                        <td className="px-4 py-2 text-[#1d212b]">
                          {d.country ?? <span className="text-[#cbd5e1]">—</span>}
                        </td>
                        <td className="px-4 py-2 text-[#1d212b]">
                          {d.year ?? <span className="text-[#cbd5e1]">—</span>}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5 text-[#1d212b]">
                            <span className="truncate" title={d.filename}>
                              {d.filename}
                            </span>
                            {d.source_url && (
                              <a
                                href={d.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open source URL"
                                className="text-[#778899] hover:text-[#4472c4]"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(d.tags || {}).map(([k, v]) => (
                              <span
                                key={k}
                                className="rounded bg-[#f0f5ff] px-1.5 py-0.5 text-[10px] text-[#4472c4]"
                              >
                                {k}: {String(v)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center gap-1 text-xs ${statusMeta.color}`}>
                            <StatusIcon className="h-3 w-3" />
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-[#1d212b]">
                          {d.chunk_count > 0 ? d.chunk_count.toLocaleString() : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* CTA to /query for this collection */}
            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-[#778899]">
                {data.country_summary.length} countries •{" "}
                {data.country_summary.reduce((s, c) => s + c.embedded, 0)} embedded
              </p>
              <Link
                href={`/query?collection=${collection}${selectedCountry ? `` : ""}`}
                className="font-medium text-[#4472c4] hover:underline"
              >
                Query this collection →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
