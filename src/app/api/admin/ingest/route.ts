/**
 * POST /api/admin/ingest
 *
 * Pulls one catalogued document through the full ingest pipeline:
 *   resolve PDF URL → download → parse → chunk → embed → insert chunks →
 *   mark documents.ingestion_status='embedded'.
 *
 * Request: { document_id: string }
 * Response: { ok: true, document_id, chunk_count, page_count, pdf_bytes,
 *             duration_ms } on success, or { ok: false, error } on failure.
 *
 * One document per call so we stay comfortably under Vercel's maxDuration.
 * The admin UI loops over a queue of catalogued doc ids client-side.
 *
 * Auth: ADMIN_TOKEN via the standard isAdmin() gate.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { ingestDocument } from "@/lib/ingest";

export const runtime = "nodejs";
// PDF download + parse + ~30+ embedding calls can take 20–60s per document
// depending on PDF size. Vercel Pro allows up to 300; keep some headroom.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { document_id?: unknown } = {};
  try {
    body = (await req.json()) as { document_id?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const documentId = typeof body.document_id === "string" ? body.document_id : "";
  if (!documentId) {
    return NextResponse.json({ error: "document_id required" }, { status: 400 });
  }

  try {
    const result = await ingestDocument(documentId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 500 with detail, not 200 — admin UI shows the failure clearly and the
    // document row stays 'catalogued' so the operator can retry after the
    // upstream issue is resolved.
    console.error(`Ingest failed for ${documentId}:`, msg);
    return NextResponse.json(
      { ok: false, document_id: documentId, error: msg },
      { status: 500 }
    );
  }
}
