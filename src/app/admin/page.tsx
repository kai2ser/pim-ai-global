"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  PlayCircle,
} from "lucide-react";

const TOKEN_KEY = "pim_admin_token";

interface RefreshRun {
  id: number;
  triggered_at: string;
  triggered_by: "cron" | "admin";
  collection_id: string;
  scraper: string;
  status: "ok" | "partial" | "error" | "stub";
  dry_run: boolean;
  fetched_count: number;
  new_count: number;
  duration_ms: number;
  error_message: string | null;
}

interface RefreshResult {
  ok: boolean;
  dry_run?: boolean;
  total_fetched: number;
  total_new: number;
  duration_ms: number;
  per_scraper: Array<{
    scraper: string;
    collection: string;
    status: RefreshRun["status"];
    fetched_count: number;
    new_count: number;
    duration_ms: number;
    error_message?: string;
  }>;
}

const STATUS_BADGE: Record<RefreshRun["status"], { label: string; color: string }> = {
  ok: { label: "OK", color: "bg-emerald-100 text-emerald-700" },
  partial: { label: "Partial", color: "bg-amber-100 text-amber-700" },
  error: { label: "Error", color: "bg-red-100 text-red-700" },
  stub: { label: "Stub", color: "bg-slate-100 text-slate-600" },
};

function fmtAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AdminPage() {
  const [needsAuth, setNeedsAuth] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [runs, setRuns] = useState<RefreshRun[]>([]);
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [lastResult, setLastResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError("");
    setNeedsAuth(false);
    try {
      const token = typeof window !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null;
      const res = await fetch("/api/admin/recent-refreshes", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 403) {
        setNeedsAuth(true);
        return;
      }
      if (!res.ok) {
        setError(`Server error: ${res.status}`);
        return;
      }
      const json = await res.json();
      setRuns(json.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const submitToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput) return;
    sessionStorage.setItem(TOKEN_KEY, tokenInput);
    setTokenInput("");
    fetchRuns();
  };

  const triggerRefresh = async () => {
    setRunning(true);
    setLastResult(null);
    setError("");
    try {
      const token = sessionStorage.getItem(TOKEN_KEY) || "";
      const res = await fetch("/api/admin/refresh-registry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Server error: ${res.status}`);
        return;
      }
      const result: RefreshResult = await res.json();
      setLastResult(result);
      // Refresh the recent-runs log so the new run shows up.
      fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (needsAuth) {
    return (
      <div className="mx-auto max-w-md px-6 py-24">
        <h1 className="font-heading text-2xl font-bold text-[#1d212b]">
          Admin token required
        </h1>
        <p className="mt-3 text-sm text-[#778899]">
          /admin triggers registry scrapers and write operations. Paste your{" "}
          <code>ADMIN_TOKEN</code> to continue. It will be kept in this tab&apos;s
          session storage only.
        </p>
        <form onSubmit={submitToken} className="mt-6 space-y-3">
          <input
            type="password"
            autoFocus
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="ADMIN_TOKEN"
            className="w-full rounded-md border border-[#d9dce0] px-3 py-2 text-sm focus:border-[#4472c4] focus:outline-none"
          />
          <Button type="submit" disabled={!tokenInput}>Unlock</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
          Operator
        </p>
        <h1 className="font-heading text-3xl font-bold text-[#1d212b] md:text-4xl">
          Admin
        </h1>
        <p className="mt-3 max-w-3xl text-[#778899]">
          Trigger registry refresh runs and inspect recent activity. Vercel Cron
          runs the refresh automatically on the first of every month at 06:00 UTC.
        </p>
      </div>

      {/* Refresh trigger */}
      <div className="mt-8 rounded-lg border border-[#dce4f0] bg-white p-6 shadow-sm">
        <h2 className="font-heading text-lg font-semibold text-[#1d212b]">
          Refresh registry now
        </h2>
        <p className="mt-1 text-sm text-[#778899]">
          Runs all three scrapers (PEFA, IMF PIMA, World Bank). Use{" "}
          <strong>dry-run</strong> to preview the diff without writing.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#1d212b]">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4 rounded border-[#dce4f0] text-[#4472c4]"
            />
            Dry-run (don&apos;t write to documents)
          </label>
          <Button onClick={triggerRefresh} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            {dryRun ? "Run dry-run" : "Run for real"}
          </Button>
        </div>

        {lastResult && (
          <div className="mt-4 rounded-md bg-[#f8fafc] p-3 text-sm">
            <p className="font-medium text-[#1d212b]">
              {lastResult.dry_run ? "Dry-run result" : "Run result"} —{" "}
              {lastResult.total_fetched} fetched, {lastResult.total_new} new,{" "}
              {(lastResult.duration_ms / 1000).toFixed(1)}s
            </p>
            <ul className="mt-2 space-y-1 text-xs text-[#778899]">
              {lastResult.per_scraper.map((p) => (
                <li key={p.scraper}>
                  <span className="font-medium text-[#1d212b]">{p.scraper}</span>
                  {" — "}
                  <span className={`inline-flex rounded px-1.5 py-0.5 ${STATUS_BADGE[p.status].color}`}>
                    {STATUS_BADGE[p.status].label}
                  </span>{" "}
                  · fetched {p.fetched_count} · new {p.new_count} ·{" "}
                  {(p.duration_ms / 1000).toFixed(1)}s
                  {p.error_message && (
                    <span className="ml-2 text-red-600">{p.error_message}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Recent runs */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-[#1d212b]">
            Recent runs
          </h2>
          <Button variant="outline" size="sm" onClick={fetchRuns} disabled={loading}>
            <RefreshCw className={`mr-2 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-[#dce4f0] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[#dce4f0] bg-[#f8fafc] text-xs uppercase tracking-wider text-[#778899]">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">By</th>
                <th className="px-4 py-2 text-left">Scraper</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Fetched</th>
                <th className="px-4 py-2 text-right">New</th>
                <th className="px-4 py-2 text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#778899]">
                    No runs yet. Trigger one above.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-[#f0f5ff] last:border-0">
                  <td className="px-4 py-2 text-[#1d212b]">
                    <Clock className="mr-1 inline h-3 w-3 text-[#778899]" />
                    {fmtAgo(r.triggered_at)}
                  </td>
                  <td className="px-4 py-2 text-[#778899]">{r.triggered_by}{r.dry_run ? " (dry)" : ""}</td>
                  <td className="px-4 py-2 text-[#1d212b]">{r.scraper}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[r.status].color}`}>
                      {r.status === "ok" ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                      {STATUS_BADGE[r.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-[#1d212b]">{r.fetched_count}</td>
                  <td className="px-4 py-2 text-right text-[#1d212b]">{r.new_count}</td>
                  <td className="px-4 py-2 text-right text-[#778899]">
                    {(r.duration_ms / 1000).toFixed(1)}s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
