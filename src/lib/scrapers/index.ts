/**
 * Scraper orchestrator. Runs every scraper sequentially, writes results to
 * registry_refresh_log, and (unless dry-run) upserts new documents into
 * the registry.
 *
 * Called by:
 *   - /api/cron/refresh-registry  (Vercel cron, monthly)
 *   - /api/admin/refresh-registry (manual trigger from /admin)
 *
 * Idempotent against the `documents` UNIQUE (collection_id, filepath)
 * constraint. We use `filepath = filename` as the dedupe key — this matches
 * the canonical CSV-seeded rows (after migration 014) so the scraper and
 * the CSV catalogue converge on the same row instead of producing two
 * records per assessment. The upstream URL is still kept in `source_url`.
 */

import { getServiceClient } from "@/lib/supabase";
import { maybeAlertOnRefresh } from "@/lib/alerts";
import { pefaScraper } from "./pefa";
import { pimaScraper } from "./pima";
import { wbgScraper } from "./wbg";
import type { ScrapedDocument, Scraper, ScraperResult } from "./types";

const SCRAPERS: Scraper[] = [pefaScraper, pimaScraper, wbgScraper];

export interface OrchestratorOptions {
  /** 'cron' or 'admin' — recorded in registry_refresh_log.triggered_by. */
  triggeredBy: "cron" | "admin";
  /** When true: do everything except actually write to documents. */
  dryRun?: boolean;
  /** Limit how many docs each scraper produces (testing). */
  maxItemsPerScraper?: number;
  /** Run scrapers in smoke-test mode (no network). */
  smokeTest?: boolean;
  /** Filter to a single scraper by name. */
  only?: string;
}

export interface OrchestratorResult {
  total_fetched: number;
  total_new: number;
  duration_ms: number;
  per_scraper: Array<{
    scraper: string;
    collection: string;
    status: ScraperResult["status"];
    fetched_count: number;
    new_count: number;
    duration_ms: number;
    error_message?: string;
  }>;
}

/**
 * Upsert one batch of scraped docs into `documents`. Returns the count of
 * actually-new rows (the rest were existing rows that got refreshed).
 */
async function upsertBatch(
  supabase: ReturnType<typeof getServiceClient>,
  collection: string,
  docs: ScrapedDocument[]
): Promise<number> {
  if (docs.length === 0) return 0;

  // Defense-in-depth dedupe: keep at most one doc per filename in the batch.
  // Postgres's ON CONFLICT … DO UPDATE can't touch the same row twice in one
  // statement, so a scraper that emits two docs with identical filenames
  // aborts the whole upsert. Individual scrapers do their own dedupe (see
  // pefa.ts's national-by-(country,year) collapse), but this guard catches
  // any future regression cheaply — first occurrence wins.
  const seenFilenames = new Set<string>();
  docs = docs.filter((d) => {
    if (seenFilenames.has(d.filename)) return false;
    seenFilenames.add(d.filename);
    return true;
  });

  // First, find out which docs already exist by checking against the
  // (collection_id, filepath) unique key. We use the canonical filename
  // (e.g. "PEFA 2026 Cabo Verde.pdf") as filepath so scraper-added rows
  // collide with the CSV-seeded rows and dedupe naturally. See migration
  // 014 for the one-time normalization of legacy rows.
  const filepaths = docs.map((d) => d.filename);
  const { data: existing } = await supabase
    .from("documents")
    .select("filepath")
    .eq("collection_id", collection)
    .in("filepath", filepaths);
  const existingSet = new Set((existing ?? []).map((r) => r.filepath as string));

  // Why we split into INSERT(new) + UPDATE(existing) instead of one upsert:
  // supabase-js .upsert() does ON CONFLICT DO UPDATE SET (every-column-in-
  // payload). If `ingestion_status` is in the payload it gets stamped onto
  // every existing row — silently demoting docs already in 'embedded' (or
  // 'excluded', etc.) back to 'catalogued'. The June 1 cron hit this exact
  // failure mode and undid the 100+ PIMA docs we'd just ingested.
  //
  // Split-batch keeps the cron idempotent for existing docs:
  //   - INSERT-new branch sets ingestion_status='catalogued' (correct first-
  //     time-seen value).
  //   - UPDATE-existing branch refreshes metadata (title, country, year,
  //     tags, source_url, source_last_seen) but never touches
  //     ingestion_status, chunk_count, file_size_bytes, page_count — those
  //     belong to the ingest pipeline.
  const organization =
    collection === "pefa_reports"
      ? "PEFA Secretariat"
      : collection === "pima_reports"
        ? "IMF"
        : collection === "wbg_pers"
          ? "World Bank"
          : null;
  const now = new Date().toISOString();

  const newDocs = docs.filter((d) => !existingSet.has(d.filename));
  const refreshDocs = docs.filter((d) => existingSet.has(d.filename));

  if (newDocs.length > 0) {
    const insertRows = newDocs.map((d) => ({
      collection_id: collection,
      filename: d.filename,
      filepath: d.filename,
      title: d.title,
      country: d.country,
      year: d.year,
      organization,
      file_type: "pdf",
      file_size_bytes: null,
      page_count: null,
      chunk_count: 0,
      tags: d.tags,
      source_url: d.sourceUrl,
      source_last_seen: now,
      ingestion_status: "catalogued",
      metadata: d.metadata,
    }));
    const { error: insErr } = await supabase.from("documents").insert(insertRows);
    if (insErr) {
      throw new Error(`insert into documents failed: ${insErr.message}`);
    }
  }

  if (refreshDocs.length > 0) {
    // One UPDATE per existing doc. supabase-js doesn't support per-row bulk
    // updates with different values, but at ~100–800 refresh rows per cron
    // (per collection) the round-trip cost is small relative to the
    // scrape itself. Done in parallel via Promise.all for throughput.
    await Promise.all(
      refreshDocs.map((d) =>
        supabase
          .from("documents")
          .update({
            // Refresh metadata that legitimately changes upstream.
            title: d.title,
            country: d.country,
            year: d.year,
            tags: d.tags,
            source_url: d.sourceUrl,
            source_last_seen: now,
            metadata: d.metadata,
            // Deliberately NOT updating: ingestion_status, chunk_count,
            // file_size_bytes, page_count. Those are owned by the ingest
            // pipeline.
          })
          .eq("collection_id", collection)
          .eq("filepath", d.filename)
          .then(({ error }) => {
            if (error) {
              throw new Error(
                `update documents failed for ${d.filename}: ${error.message}`
              );
            }
          })
      )
    );
  }

  return newDocs.length;
}

async function logRun(
  supabase: ReturnType<typeof getServiceClient>,
  args: {
    triggeredBy: "cron" | "admin";
    collection: string;
    scraper: string;
    status: ScraperResult["status"];
    dryRun: boolean;
    fetchedCount: number;
    newCount: number;
    durationMs: number;
    errorMessage?: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from("registry_refresh_log").insert({
    triggered_by: args.triggeredBy,
    collection_id: args.collection,
    scraper: args.scraper,
    status: args.status,
    dry_run: args.dryRun,
    fetched_count: args.fetchedCount,
    new_count: args.newCount,
    duration_ms: args.durationMs,
    error_message: args.errorMessage,
    metadata: args.metadata,
  });
  if (error) {
    console.error("Failed to write registry_refresh_log:", error.message);
  }
}

export async function refreshRegistry(
  opts: OrchestratorOptions
): Promise<OrchestratorResult> {
  const supabase = getServiceClient();
  const t0 = Date.now();
  const perScraper: OrchestratorResult["per_scraper"] = [];

  for (const scraper of SCRAPERS) {
    if (opts.only && scraper.name !== opts.only) continue;

    const ts = Date.now();
    let result: ScraperResult;
    try {
      result = await scraper.run({
        maxItems: opts.maxItemsPerScraper,
        smokeTest: opts.smokeTest,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        scraper: scraper.name,
        collection: scraper.collection,
        status: "error",
        documents: [],
        errorMessage: msg,
        metadata: {},
      };
    }

    let newCount = 0;
    if (!opts.dryRun && result.documents.length > 0 && result.status !== "error" && result.status !== "stub") {
      try {
        newCount = await upsertBatch(
          supabase,
          result.collection,
          result.documents
        );
      } catch (e) {
        result.status = "error";
        result.errorMessage = e instanceof Error ? e.message : String(e);
      }
    }

    const durationMs = Date.now() - ts;
    await logRun(supabase, {
      triggeredBy: opts.triggeredBy,
      collection: result.collection,
      scraper: result.scraper,
      status: result.status,
      dryRun: opts.dryRun ?? false,
      fetchedCount: result.documents.length,
      newCount,
      durationMs,
      errorMessage: result.errorMessage,
      metadata: result.metadata,
    });

    perScraper.push({
      scraper: result.scraper,
      collection: result.collection,
      status: result.status,
      fetched_count: result.documents.length,
      new_count: newCount,
      duration_ms: durationMs,
      error_message: result.errorMessage,
    });
  }

  const result: OrchestratorResult = {
    total_fetched: perScraper.reduce((s, r) => s + r.fetched_count, 0),
    total_new: perScraper.reduce((s, r) => s + r.new_count, 0),
    duration_ms: Date.now() - t0,
    per_scraper: perScraper,
  };

  // Fire-and-forget alerting. maybeAlertOnRefresh is self-gated: skips on
  // dry-runs, skips when no scraper failed, skips when no channel configured.
  // Any send failure is logged inside and never propagates here.
  await maybeAlertOnRefresh({
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun ?? false,
    totalFetched: result.total_fetched,
    totalNew: result.total_new,
    durationMs: result.duration_ms,
    perScraper: result.per_scraper,
  });

  return result;
}
