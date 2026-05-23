/**
 * PEFA Secretariat scraper — fetches the full assessments catalogue from
 * pefa.org/assessments and normalises each row into a ScrapedDocument.
 *
 * The PEFA Secretariat publishes an HTML listing of assessments with
 * inline metadata (country, year, level, status, availability). Each
 * assessment row carries a node-id link to its detail page.
 *
 * Our existing 148 catalogued PEFA reports came from a hand-curated CSV
 * (`latest_national_pefas.csv`). This scraper expands the registry to the
 * full ~1800 historical PEFA assessments (per the xlsx the user shared
 * on day 1) including National, Subnational, Climate, and Gender variants.
 *
 * Notes on robustness:
 *   - pefa.org changes its DOM occasionally. The selectors below are
 *     deliberately loose (look for anchor tags with /node/<id>, parse
 *     surrounding card text). When pefa.org changes layout, the scraper
 *     degrades to status='partial' or 'error' rather than crashing.
 *   - Respect upstream: paginate sequentially with a 250ms delay between
 *     pages, identify as a research crawler in User-Agent.
 *   - Run as part of monthly cron only — not on every request.
 */

import type { Scraper, ScraperOptions, ScraperResult, ScrapedDocument } from "./types";

const PEFA_BASE = "https://www.pefa.org";
const PEFA_LIST_URL = `${PEFA_BASE}/assessments`;
const USER_AGENT =
  "pim-ai-global-bot/1.0 (research; +https://pim-ai-global.vercel.app)";
const PAGE_DELAY_MS = 250;
const MAX_PAGES = 60; // pefa.org has ~50 pages of assessments

interface RawRow {
  nodeUrl: string;          // https://www.pefa.org/node/<id>
  rowText: string;          // full text content of the card/row
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pull the listing page; extract every node-id link + its surrounding text.
 *
 * Approach: find all `<a href="/node/NNNN"…>` matches, then for each take
 * a ~500-char window of text around the anchor as the "row text". The
 * extractor below then derives country, year, level, status from that text.
 */
async function fetchListPage(pageNum: number): Promise<RawRow[]> {
  const url = pageNum === 0 ? PEFA_LIST_URL : `${PEFA_LIST_URL}?page=${pageNum}`;
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`pefa.org page ${pageNum}: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  // Build a lookup of every assessment-node link + its surrounding 500 chars.
  const re = /<a[^>]+href="(\/node\/(\d+))"[^>]*>([^<]*)<\/a>/gi;
  const rows: RawRow[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const nodeUrl = `${PEFA_BASE}${m[1]}`;
    if (seen.has(nodeUrl)) continue;
    seen.add(nodeUrl);
    const idx = m.index;
    const start = Math.max(0, idx - 200);
    const end = Math.min(html.length, idx + 500);
    // Strip HTML tags from the window so the row text is plain.
    const rowText = html.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    rows.push({ nodeUrl, rowText });
  }
  return rows;
}

function parseYear(text: string): number | null {
  const m = text.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

/** Best-effort country extraction from row text. */
function parseCountry(text: string): string | null {
  // pefa.org rows tend to look like: "Albania - 2025 - National - Final - Public"
  // The country is usually the first segment before " - " or " — ".
  const seg = text.split(/\s+[-—]\s+/)[0].trim();
  // Sanity-check: country names are 2-50 chars, mostly letters/spaces/dots.
  if (seg.length < 2 || seg.length > 50) return null;
  if (!/^[A-Za-z][A-Za-z ,.()&'\-]+$/.test(seg)) return null;
  return seg;
}

function parseCategory(
  text: string
): "national" | "subnational" | "climate" | "gender" {
  const t = text.toLowerCase();
  if (t.includes("climate")) return "climate";
  if (t.includes("gender")) return "gender";
  if (t.includes("subnational")) return "subnational";
  return "national";
}

function parseAvailability(text: string): "Public" | "Non-public" {
  return /non[- ]public/i.test(text) ? "Non-public" : "Public";
}

function parseStatus(text: string): string | null {
  const m = text.match(/\b(Final|Draft|Concept|Planned)\b/i);
  return m ? m[1] : null;
}

function rowToDocument(raw: RawRow): ScrapedDocument | null {
  const country = parseCountry(raw.rowText);
  const year = parseYear(raw.rowText);
  const category = parseCategory(raw.rowText);
  const availability = parseAvailability(raw.rowText);
  const status = parseStatus(raw.rowText);

  if (!country) return null; // can't index without a country

  // Suggested filename mirrors the convention from the CSV-seeded rows so the
  // (collection_id, filepath) UNIQUE constraint dedupes against the existing
  // 148 catalogued PEFA reports.
  const categoryLabel =
    category === "national" ? "" :
    category === "subnational" ? "Subnational " :
    category === "climate" ? "Climate " :
    "Gender ";
  const yearLabel = year ?? "Undated";
  const filename = `PEFA ${categoryLabel}${yearLabel} ${country}.pdf`;
  const title = `${country} ${yearLabel} ${categoryLabel || "National "}PEFA`.trim();

  const nodeId = raw.nodeUrl.match(/\/node\/(\d+)/)?.[1] ?? "";

  return {
    sourceUrl: raw.nodeUrl,
    filename,
    title,
    country,
    year,
    tags: {
      category,
      availability,
      is_public: availability === "Public",
    },
    metadata: {
      status,
      availability,
      is_public: availability === "Public",
      node_id: nodeId,
      page_url: raw.nodeUrl,
      scraper: "pefa",
      raw_row: raw.rowText.slice(0, 240),
    },
  };
}

export const pefaScraper: Scraper = {
  name: "pefa",
  collection: "pefa_reports",

  async run(opts: ScraperOptions): Promise<ScraperResult> {
    if (opts.smokeTest) {
      // Deterministic smoke output — useful for dry-run testing.
      return {
        scraper: "pefa",
        collection: "pefa_reports",
        status: "ok",
        documents: [
          {
            sourceUrl: "https://www.pefa.org/node/0",
            filename: "PEFA 2099 SmokeTest.pdf",
            title: "SmokeTest 2099 PEFA",
            country: "SmokeTest",
            year: 2099,
            tags: { category: "national", availability: "Public", is_public: true },
            metadata: { scraper: "pefa", smoke: true },
          },
        ],
        metadata: { mode: "smoke_test" },
      };
    }

    const documents: ScrapedDocument[] = [];
    const pagesVisited: string[] = [];
    let lastError: string | undefined;
    let status: ScraperResult["status"] = "ok";

    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const rows = await fetchListPage(page);
        pagesVisited.push(`page=${page}`);

        // pefa.org pagination ends silently — when we get no new node IDs on a
        // page, stop scraping.
        if (rows.length === 0) break;
        const sizeBefore = documents.length;
        for (const r of rows) {
          const doc = rowToDocument(r);
          if (doc) documents.push(doc);
          if (opts.maxItems && documents.length >= opts.maxItems) break;
        }
        if (documents.length === sizeBefore) {
          // No new docs found on this page — likely past the last page.
          break;
        }
        if (opts.maxItems && documents.length >= opts.maxItems) break;

        await delay(PAGE_DELAY_MS);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        status = "partial";
        // Don't crash — return whatever we got. Operator can re-run.
        break;
      }
    }

    return {
      scraper: "pefa",
      collection: "pefa_reports",
      status: documents.length === 0 ? (lastError ? "error" : "stub") : status,
      documents,
      errorMessage: lastError,
      metadata: { pages_visited: pagesVisited.length, source: PEFA_LIST_URL },
    };
  },
};
