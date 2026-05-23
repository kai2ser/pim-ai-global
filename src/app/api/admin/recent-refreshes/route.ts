/**
 * GET /api/admin/recent-refreshes
 *
 * Returns the most recent registry_refresh_log entries for display in /admin.
 * Admin-gated.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("registry_refresh_log")
    .select(
      "id, triggered_at, triggered_by, collection_id, scraper, status, dry_run, fetched_count, new_count, duration_ms, error_message"
    )
    .order("triggered_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ runs: data ?? [] });
}
