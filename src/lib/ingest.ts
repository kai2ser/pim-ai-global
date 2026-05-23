/**
 * Ingest pipeline: catalogued document → embedded chunks.
 *
 * Steps for one document:
 *   1. Resolve the actual PDF URL (per-collection — PEFA needs an extra hop
 *      to scrape the report PDF link off the node page; PIMA / WBG / pim_lit
 *      already store the direct PDF URL in source_url).
 *   2. Download the PDF (size-capped, timeout-capped).
 *   3. Parse with pdf-parse, producing the full text plus per-page offsets so
 *      each chunk can be tagged with its page number for citation.
 *   4. Character-window chunking (~3000 chars, ~500 overlap). This lands at
 *      ~750 tokens per chunk for English prose — comfortably under
 *      text-embedding-3-large's 8191-token input limit.
 *   5. Batch-embed chunks via OpenAI (32 at a time).
 *   6. Insert rows into the collection's chunk table.
 *   7. Update the documents row: chunk_count, page_count, ingestion_status.
 *
 * Throwing aborts mid-flight; partial chunk inserts up to that point remain,
 * but the documents row is left in 'catalogued' so a retry re-attempts the
 * whole doc. To make retries safe we delete any pre-existing chunks for
 * this document_id at the start.
 */

// Note: importing the wrapper `pdf-parse` runs a debug code path that tries to
// open a bundled sample PDF at module-init — that fails on Vercel's read-only
// FS. The inner module skips that branch.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { getServiceClient } from "@/lib/supabase";
import type { CollectionName } from "@/lib/supabase";
import { getEmbeddings } from "@/lib/embeddings";

const USER_AGENT =
  "pim-ai-global-bot/1.0 (research; +https://pim-ai-global.vercel.app)";
// 100 MB — sized for the largest legitimate PERs we've seen in the wild
// (Namibia 2025 is 68 MB). pdf-parse holds the whole document in memory at
// ~4× expansion; on Vercel Pro's 1024 MB function we still have plenty of
// headroom for embeddings + working memory.
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const CHUNK_SIZE_CHARS = 3000;
const CHUNK_OVERLAP_CHARS = 500;
const EMBED_BATCH = 32;

interface DocumentRow {
  id: string;
  collection_id: CollectionName;
  filename: string;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
}

interface PreparedChunk {
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
}

export interface IngestResult {
  document_id: string;
  collection: CollectionName;
  chunk_count: number;
  page_count: number;
  pdf_bytes: number;
  duration_ms: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* PDF URL resolution                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Returns the direct PDF URL for a document, fetching the landing page first
 * if needed. PEFA stores the assessment node URL (https://www.pefa.org/node/N)
 * and we have to look up the actual final-report PDF link from that page.
 * Other collections already store the PDF URL in source_url.
 */
async function resolvePdfUrl(doc: DocumentRow): Promise<string> {
  if (!doc.source_url) {
    throw new Error(`Document ${doc.id} has no source_url`);
  }
  const url = doc.source_url;

  // Already a PDF URL — return as-is. We pattern-match rather than blindly
  // trusting source_url because we want to catch PEFA node URLs explicitly.
  if (/\.pdf(\?.*)?$/i.test(url)) return url;
  if (url.startsWith("https://documents.worldbank.org/")) return url;
  if (url.startsWith("https://infrastructuregovern.imf.org/content/dam/PIMA/")) return url;

  // PEFA node URL → scrape the page for the final-report PDF link.
  if (/https?:\/\/www\.pefa\.org\/node\/\d+/.test(url)) {
    return await resolvePefaPdfUrl(url);
  }

  // Otherwise assume source_url is the PDF.
  return url;
}

/**
 * PEFA node pages embed download buttons pointing at the assessment PDF,
 * usually under /sites/default/files/. Pick the first one that looks like a
 * final report (prefer .pdf URLs with "Final" or "Report" in the path).
 */
async function resolvePefaPdfUrl(nodeUrl: string): Promise<string> {
  const res = await fetch(nodeUrl, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`PEFA node fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  // Collect candidate PDF anchors. Match both relative ("/sites/...") and
  // absolute ("https://www.pefa.org/sites/...") forms.
  const candidates: string[] = [];
  const re = /href="((?:https?:\/\/www\.pefa\.org)?\/sites\/[^"]+\.pdf)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const u = m[1].startsWith("http") ? m[1] : `https://www.pefa.org${m[1]}`;
    if (!candidates.includes(u)) candidates.push(u);
  }
  if (candidates.length === 0) {
    throw new Error(`No PDF link found on PEFA node page ${nodeUrl}`);
  }
  // Prefer URLs that mention "Final" or "Report" — PEFA pages occasionally
  // attach concept notes or appendices that aren't the main assessment.
  const preferred = candidates.find((u) => /final|report|assessment/i.test(u));
  return preferred ?? candidates[0];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* PDF download                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

async function downloadPdf(url: string): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/pdf" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`PDF download failed: ${res.status} ${res.statusText} for ${url}`);
    }
    const len = res.headers.get("content-length");
    if (len && parseInt(len, 10) > MAX_PDF_BYTES) {
      throw new Error(`PDF too large: ${len} bytes (>${MAX_PDF_BYTES})`);
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_PDF_BYTES) {
      throw new Error(`PDF too large: ${ab.byteLength} bytes (>${MAX_PDF_BYTES})`);
    }
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* PDF → text + per-page offsets                                               */
/* ────────────────────────────────────────────────────────────────────────── */

interface ParsedPdf {
  text: string;
  pageCount: number;
  /** Offsets in `text` at which each page starts (length === pageCount). */
  pageStartOffsets: number[];
}

async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  // Use a custom pagerender to emit each page joined by a form-feed marker so
  // we can recover per-page offsets. We then strip the markers from the final
  // text but record their positions.
  const FORM_FEED = "\f";
  const data = await pdfParse(buffer, {
    pagerender: async (pageData: {
      getTextContent: (opts: object) => Promise<{ items: Array<{ str: string }> }>;
    }) => {
      const tc = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      return tc.items.map((it) => it.str).join(" ") + "\n" + FORM_FEED;
    },
  });

  const raw = (data.text as string) ?? "";
  // Walk the raw string, building cleaned text + per-page start offsets.
  const pages = raw.split(FORM_FEED);
  // Drop the trailing empty fragment that comes after the last FF.
  if (pages.length > 0 && pages[pages.length - 1].trim() === "") pages.pop();
  const offsets: number[] = [];
  let cleaned = "";
  for (const pageText of pages) {
    offsets.push(cleaned.length);
    cleaned += pageText;
  }
  // numpages can disagree with our page count if pagerender ran on N but the
  // PDF metadata says M. Trust pagerender's actual page-by-page rendering.
  return {
    text: cleaned,
    pageCount: pages.length || (data.numpages as number) || 0,
    pageStartOffsets: offsets,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Chunking                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Sliding-window character chunker. Aligns chunk boundaries to whitespace
 * when possible so we don't split a word across chunks.
 * Each chunk is tagged with the page number it starts on.
 */
function chunkPdfText(parsed: ParsedPdf): PreparedChunk[] {
  const { text, pageStartOffsets } = parsed;
  const chunks: PreparedChunk[] = [];

  // Page lookup: binary search would be more efficient, but page counts are
  // small (a few hundred at most) so a linear scan from the last known page
  // is fine.
  let lastPageIdx = 0;
  const pageForOffset = (off: number): number => {
    while (
      lastPageIdx + 1 < pageStartOffsets.length &&
      pageStartOffsets[lastPageIdx + 1] <= off
    ) {
      lastPageIdx++;
    }
    while (lastPageIdx > 0 && pageStartOffsets[lastPageIdx] > off) {
      lastPageIdx--;
    }
    return lastPageIdx + 1; // 1-indexed
  };

  let cursor = 0;
  let chunkIndex = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + CHUNK_SIZE_CHARS, text.length);
    // Snap end backward to a whitespace boundary if we're not at EOF, so we
    // don't slice through a word.
    if (end < text.length) {
      const ws = text.lastIndexOf(" ", end);
      const nl = text.lastIndexOf("\n", end);
      const snap = Math.max(ws, nl);
      // Only snap if we still get a useful slice (don't shrink past midpoint).
      if (snap > cursor + Math.floor(CHUNK_SIZE_CHARS / 2)) {
        end = snap;
      }
    }
    const slice = text.slice(cursor, end).trim();
    if (slice.length > 0) {
      chunks.push({
        chunkIndex,
        content: slice,
        pageNumber: parsed.pageCount > 0 ? pageForOffset(cursor) : null,
      });
      chunkIndex++;
    }
    if (end >= text.length) break;
    cursor = end - CHUNK_OVERLAP_CHARS;
    if (cursor < 0) cursor = 0;
  }
  return chunks;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Embedding + insertion                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

async function embedAndInsert(
  supabase: ReturnType<typeof getServiceClient>,
  collection: CollectionName,
  docId: string,
  chunks: PreparedChunk[]
): Promise<void> {
  if (chunks.length === 0) return;

  // Drop any stale chunks from a previous failed ingest run for this doc.
  // Safe because we only ingest 'catalogued' rows; a row in 'embedded' already
  // means upstream code chose not to re-ingest.
  const { error: delErr } = await supabase
    .from(collection)
    .delete()
    .eq("document_id", docId);
  if (delErr) throw new Error(`Failed to clear stale chunks: ${delErr.message}`);

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const embeddings = await getEmbeddings(batch.map((c) => c.content));
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch: got ${embeddings.length} for ${batch.length} inputs`
      );
    }
    const rows = batch.map((c, j) => ({
      document_id: docId,
      chunk_index: c.chunkIndex,
      content: c.content,
      // NB: only pefa_reports has token_count + section_heading columns in the
      // chunk-table schema. pim_literature / pima_reports / wbg_pers don't.
      // Sticking to the columns all four tables share keeps a single insert
      // shape across collections without needing per-collection branches.
      page_number: c.pageNumber,
      // halfvec(3072) accepts a JSON array literal of floats.
      embedding: embeddings[j],
      metadata: {},
    }));
    const { error: insErr } = await supabase.from(collection).insert(rows);
    if (insErr) {
      throw new Error(`Chunk insert failed (batch ${i}-${i + batch.length}): ${insErr.message}`);
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Orchestrator                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export async function ingestDocument(documentId: string): Promise<IngestResult> {
  const supabase = getServiceClient();
  const t0 = Date.now();

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, collection_id, filename, source_url, metadata, ingestion_status")
    .eq("id", documentId)
    .single();

  if (docErr || !doc) {
    throw new Error(`Document ${documentId} not found: ${docErr?.message ?? "no row"}`);
  }
  if (doc.ingestion_status === "embedded") {
    throw new Error(`Document ${documentId} is already embedded.`);
  }

  const pdfUrl = await resolvePdfUrl(doc as DocumentRow);
  const pdfBuf = await downloadPdf(pdfUrl);
  const parsed = await parsePdf(pdfBuf);
  if (!parsed.text || parsed.text.trim().length < 200) {
    throw new Error(
      `Parsed PDF text too short (${parsed.text?.length ?? 0} chars). The PDF may be scanned or empty.`
    );
  }
  const chunks = chunkPdfText(parsed);
  await embedAndInsert(supabase, doc.collection_id as CollectionName, documentId, chunks);

  // Promote the document row to embedded + record observed counts.
  const { error: upErr } = await supabase
    .from("documents")
    .update({
      ingestion_status: "embedded",
      chunk_count: chunks.length,
      page_count: parsed.pageCount,
      file_size_bytes: pdfBuf.length,
      ingested_at: new Date().toISOString(),
      metadata: {
        ...(doc.metadata as Record<string, unknown> ?? {}),
        ingest: {
          pdf_url: pdfUrl,
          ingested_at: new Date().toISOString(),
          chunk_size_chars: CHUNK_SIZE_CHARS,
          chunk_overlap_chars: CHUNK_OVERLAP_CHARS,
        },
      },
    })
    .eq("id", documentId);
  if (upErr) {
    throw new Error(`Failed to promote documents row: ${upErr.message}`);
  }

  return {
    document_id: documentId,
    collection: doc.collection_id as CollectionName,
    chunk_count: chunks.length,
    page_count: parsed.pageCount,
    pdf_bytes: pdfBuf.length,
    duration_ms: Date.now() - t0,
  };
}
