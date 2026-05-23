/**
 * Shared types for collection scrapers.
 *
 * A scraper hits the upstream source (pefa.org / IMF / WB / etc.), normalises
 * results into ScrapedDocument records, and returns them to the orchestrator.
 * The orchestrator decides whether to upsert each one into `documents`.
 *
 * Scrapers must be:
 *   - Idempotent: producing the same set of records on a stable upstream.
 *   - Side-effect-free: no DB writes; the orchestrator writes.
 *   - Bounded: respect a `maxItems` knob for testability.
 */

import type { CollectionName } from "@/lib/supabase";

export interface ScrapedDocument {
  /**
   * Stable identifier for upsert: combined with collection_id, this is what
   * we use to detect "already known" rows. For PEFA it's the assessment page
   * URL (e.g. https://www.pefa.org/node/486); for IMF/WB it's the document
   * landing-page URL. Becomes `documents.source_url`.
   */
  sourceUrl: string;

  /** Becomes documents.filename — the canonical filename if downloaded. */
  filename: string;

  /** Becomes documents.title — human-readable title. */
  title: string;

  country: string | null;
  year: number | null;

  /**
   * Per-collection tag schema. PEFA: {category: 'national'|'subnational'|'climate'|'gender', availability}.
   * PIMA:  {category: 'standard'|'climate'|'gender'}.
   * WBG:   {category: 'per'|'pfr'|'sector', sector?}.
   */
  tags: Record<string, string | boolean>;

  /**
   * Free-form per-document metadata. Stored as documents.metadata JSONB.
   * Things like upstream node IDs, document type breakdowns, sub-doc URLs
   * (PIMA TAR vs PIMA Summary), etc.
   */
  metadata: Record<string, unknown>;
}

export interface ScraperResult {
  scraper: string;                 // 'pefa' | 'pima' | 'wbg'
  collection: CollectionName;
  status: "ok" | "partial" | "error" | "stub";
  documents: ScrapedDocument[];
  /** When status='error' or 'partial', why? */
  errorMessage?: string;
  /** Per-run notes (URLs visited, pages scraped, etc.) for the audit log. */
  metadata: Record<string, unknown>;
}

export interface ScraperOptions {
  /** Soft cap so tests / dry-runs don't hammer upstream. */
  maxItems?: number;
  /** Skip network calls and return a deterministic small sample. */
  smokeTest?: boolean;
}

export interface Scraper {
  name: string;                    // 'pefa'
  collection: CollectionName;      // 'pefa_reports'
  run(opts: ScraperOptions): Promise<ScraperResult>;
}
