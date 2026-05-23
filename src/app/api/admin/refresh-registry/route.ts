/**
 * POST /api/admin/refresh-registry
 *
 * Manual operator trigger from /admin page. Accepts:
 *   { dry_run?: boolean, only?: 'pefa'|'pima'|'wbg', max_items?: number }
 *
 * Body params let the operator preview a run (dry_run=true returns counts
 * without writing) or scope to a single scraper.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { refreshRegistry } from "@/lib/scrapers";

export const runtime = "nodejs";
// Same scraper budget as the cron route — see comment there.
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body is fine */
  }
  const dryRun = body.dry_run === true;
  const only = typeof body.only === "string" ? body.only : undefined;
  const maxItems = typeof body.max_items === "number" ? body.max_items : undefined;

  try {
    const result = await refreshRegistry({
      triggeredBy: "admin",
      dryRun,
      only,
      maxItemsPerScraper: maxItems,
    });
    return NextResponse.json({ ok: true, dry_run: dryRun, ...result });
  } catch (err) {
    console.error("Admin refresh-registry error:", err);
    return NextResponse.json(
      { error: "Refresh failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
