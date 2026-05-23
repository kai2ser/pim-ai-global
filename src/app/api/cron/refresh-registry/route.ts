/**
 * GET /api/cron/refresh-registry
 *
 * Invoked monthly by Vercel Cron (see vercel.json). Runs every scraper and
 * upserts new documents into the registry. Always non-dry-run.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
 *       when the route is in vercel.json's `crons` config. We also accept the
 *       ADMIN_TOKEN (for manual one-off triggers via curl).
 *
 * Returns the per-scraper summary so the cron logs surface what happened.
 */

import { NextRequest, NextResponse } from "next/server";
import { isCronOrAdmin } from "@/lib/admin-auth";
import { refreshRegistry } from "@/lib/scrapers";

export const runtime = "nodejs";
// All three scrapers run in sequence:
//   PEFA: ~45 list pages × 250ms ≈ 12s
//   PIMA: 1 index + ~113 country pages × 250ms ≈ 30s + parse overhead
//   WBG:  ~2 OKR API pages ≈ 1s
// Total around 50–90s with HTML parse + DB upsert. Vercel Pro permits up to
// 300; pad to 180 so the cron doesn't fail on an upstream slowdown.
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  if (!isCronOrAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await refreshRegistry({ triggeredBy: "cron" });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Cron refresh-registry error:", err);
    return NextResponse.json(
      { error: "Refresh failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
