/**
 * GET /api/registry
 *
 * Reads the unified documents registry. Public — gated only by the
 * documents_anon_read RLS policy from migration 012 (which excludes
 * rows where ingestion_status IN ('excluded','failed')).
 *
 * Query params:
 *   collection (required) — pim_literature | pima_reports | wbg_pers | pefa_reports
 *   country    (optional) — exact country name match
 *   tag        (optional, repeating) — "key:value" filter on tags JSONB
 *                                     (e.g. tag=category:climate&tag=publisher:imf)
 *   latest_only (optional bool) — only the latest report per (country, category)
 *   page        (optional, default 1)
 *   page_size   (optional, default 50, max 200)
 *
 * Returns:
 *   {
 *     collection: { id, label, description },
 *     tag_classes: [ {key, label, allowed_values, ordering} ],
 *     country_summary: [ {country, total, embedded, latest_year} ],
 *     documents: [ {id, filename, country, year, tags, ingestion_status, chunk_count} ],
 *     pagination: {page, page_size, total_count}
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, COLLECTIONS, type CollectionName } from "@/lib/supabase";

export const runtime = "nodejs";
export const revalidate = 60;

interface TagFilter {
  key: string;
  value: string;
}

function parseTagFilters(params: URLSearchParams): TagFilter[] {
  return params
    .getAll("tag")
    .map((s) => {
      const i = s.indexOf(":");
      if (i === -1) return null;
      const key = s.slice(0, i).trim();
      const value = s.slice(i + 1).trim();
      // Sanity-check the key (alphanumeric + underscore) so we don't end up
      // building JSONB paths from user-controlled punctuation.
      if (!/^[a-z0-9_]+$/i.test(key)) return null;
      if (value.length === 0 || value.length > 64) return null;
      return { key, value };
    })
    .filter((f): f is TagFilter => f !== null);
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;

    const collection = params.get("collection") as CollectionName | null;
    if (!collection || !COLLECTIONS.find((c) => c.id === collection)) {
      return NextResponse.json(
        { error: "collection is required and must be one of the four registered collections" },
        { status: 400 }
      );
    }
    const col = COLLECTIONS.find((c) => c.id === collection)!;

    const country = params.get("country")?.trim() || null;
    const latestOnly = params.get("latest_only") === "true";
    const tagFilters = parseTagFilters(params);
    const page = Math.max(1, parseInt(params.get("page") || "1", 10));
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(params.get("page_size") || "50", 10))
    );

    const supabase = getServiceClient();

    // ── Tag classes (drives the filter chips in the UI) ──────────────
    const { data: tagClasses } = await supabase
      .from("collection_tag_classes")
      .select("tag_key, display_label, allowed_values, ordering")
      .eq("collection_id", collection)
      .order("ordering");

    // ── Documents query ──────────────────────────────────────────────
    // Use the view if latest_only=true; otherwise hit the table directly.
    // The view exposes the same shape + an rn_per_type column.
    const fromTable = latestOnly ? "documents_latest_per_type" : "documents";

    let docQuery = supabase
      .from(fromTable)
      .select(
        "id, filename, country, year, tags, ingestion_status, chunk_count, source_url, ingested_at",
        { count: "exact" }
      )
      .eq("collection_id", collection);

    if (country) docQuery = docQuery.eq("country", country);
    for (const f of tagFilters) {
      // contains/match — `tags->>key = value`. The previous parseTagFilters
      // already validated the key shape, so building this string is safe.
      docQuery = docQuery.eq(`tags->>${f.key}`, f.value);
    }

    docQuery = docQuery
      .order("year", { ascending: false, nullsFirst: false })
      .order("country", { ascending: true, nullsFirst: false })
      .order("ingested_at", { ascending: false, nullsFirst: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    const { data: documents, count, error: docErr } = await docQuery;
    if (docErr) {
      console.error("Registry docs query error:", docErr.message);
      return NextResponse.json({ error: "Failed to query registry" }, { status: 500 });
    }

    // ── Per-country roll-up ─────────────────────────────────────────
    // For PEFA we use country_registry_summary (it counts national/sub/climate/gender).
    // For other collections the summary view's per-category columns are zero
    // (because they hardcode PEFA categories), so we build a generic count
    // from documents directly.
    let countrySummary: Array<{
      country: string;
      total: number;
      embedded: number;
      latest_year: number | null;
    }> = [];

    if (collection === "pefa_reports") {
      const { data } = await supabase
        .from("country_registry_summary")
        .select("country, total_reports, embedded_count, latest_year")
        .eq("collection_id", collection);
      countrySummary = (data ?? []).map((r) => ({
        country: r.country,
        total: r.total_reports,
        embedded: r.embedded_count,
        latest_year: r.latest_year,
      }));
    } else {
      // Direct count from documents — works for all collections regardless of
      // tag schema.
      const { data: byCountry } = await supabase
        .from("documents")
        .select("country, year, ingestion_status")
        .eq("collection_id", collection)
        .not("country", "is", null);

      const map = new Map<
        string,
        { total: number; embedded: number; latest_year: number | null }
      >();
      for (const row of byCountry ?? []) {
        const c = row.country as string;
        const existing = map.get(c) ?? { total: 0, embedded: 0, latest_year: null };
        existing.total += 1;
        if (row.ingestion_status === "embedded") existing.embedded += 1;
        if (row.year && (existing.latest_year === null || row.year > existing.latest_year)) {
          existing.latest_year = row.year;
        }
        map.set(c, existing);
      }
      countrySummary = [...map.entries()]
        .map(([country, v]) => ({ country, ...v }))
        .sort((a, b) => b.total - a.total || a.country.localeCompare(b.country));
    }

    return NextResponse.json(
      {
        collection: { id: col.id, label: col.label, description: col.description },
        tag_classes: tagClasses ?? [],
        country_summary: countrySummary,
        documents: documents ?? [],
        pagination: {
          page,
          page_size: pageSize,
          total_count: count ?? 0,
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Registry API error:", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
