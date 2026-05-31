/**
 * GET /api/admin/catalogued?collection=<id>&limit=<n>&offset=<n>
 *
 * Returns up to `limit` (default 50, max 1000) documents whose
 * ingestion_status='catalogued' — i.e. they're in the registry but have no
 * embedded chunks yet. The /admin Ingest panel walks this list and POSTs each
 * id to /api/admin/ingest.
 *
 * Why limit=1000: PEFA currently has ~830 catalogued docs after a refresh,
 * and the bulk-ingest script needs to pull the entire queue in one shot to
 * dedupe against its in-run "already attempted" set. A failed ingest stays
 * in 'catalogued' status (so failures don't pollute embedded counts), which
 * means a paged crawl through limit-sized windows just keeps returning the
 * same failed docs until they all fit in one window.
 *
 * Why offset support: for collections that ever exceed 1000 catalogued, the
 * script can paginate without hitting the cap.
 *
 * Service-role read; admin-token gate. Not anon-readable.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getServiceClient, COLLECTIONS, type CollectionName } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const params = req.nextUrl.searchParams;
  const collection = params.get("collection") as CollectionName | null;
  if (!collection || !COLLECTIONS.find((c) => c.id === collection)) {
    return NextResponse.json(
      { error: "collection is required" },
      { status: 400 }
    );
  }
  const limit = Math.min(1000, Math.max(1, parseInt(params.get("limit") || "50", 10)));
  const offset = Math.max(0, parseInt(params.get("offset") || "0", 10));

  const supabase = getServiceClient();
  const { data, error, count } = await supabase
    .from("documents")
    .select("id, filename, country, year, source_url, tags", { count: "exact" })
    .eq("collection_id", collection)
    .eq("ingestion_status", "catalogued")
    .order("year", { ascending: false, nullsFirst: false })
    .order("country", { ascending: true, nullsFirst: false })
    // We use .range() instead of .limit() so the offset param applies. range
    // is inclusive on both ends; offset=0,limit=50 → range(0, 49).
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("Catalogued list error:", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  return NextResponse.json({
    collection,
    total_catalogued: count ?? 0,
    returned: data?.length ?? 0,
    documents: data ?? [],
  });
}
