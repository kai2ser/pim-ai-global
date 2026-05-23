/**
 * PEFA Secretariat scraper.
 *
 * pefa.org publishes its assessments index as a Drupal Views table at
 * /assessments/list, paginated via ?page=N. Each row is a <tr> with:
 *   - <a href="/node/<id>">Country Year</a>            (Title cell)
 *   - <td class="…views-field-field-assessment-type">…<div class="label">Type</div>National</td>
 *   - <td class="…views-field-field-country">…Country</td>
 *   - <td class="…views-field-field-assessment-status">…Final / Draft / …</td>
 *   - <td class="…views-field-field-assessment-availability">…Public / Non-public</td>
 *
 * Each call paginates from page=0 until a fetched page returns zero new
 * assessment rows. Respects upstream: ~250ms between pages, identifies as a
 * research crawler in User-Agent. Returns up to ~900 assessments total
 * (currently 45 pages × ~20 rows each).
 *
 * Earlier version of this scraper targeted /assessments (the landing page)
 * with a regex that only matched relative-path node hrefs. The landing page
 * doesn't contain the assessment table at all, and pefa.org actually uses
 * absolute URLs for table links — net result was 0 docs. This rewrite uses
 * the right URL + row-based parser + absolute-or-relative href tolerance.
 */

import type { Scraper, ScraperOptions, ScraperResult, ScrapedDocument } from "./types";

const PEFA_BASE = "https://www.pefa.org";
const PEFA_LIST_URL = `${PEFA_BASE}/assessments/list`;
const USER_AGENT =
  "pim-ai-global-bot/1.0 (research; +https://pim-ai-global.vercel.app)";
const PAGE_DELAY_MS = 250;
const MAX_PAGES = 60; // pefa.org currently has 45 pages; cap defensively

interface ParsedRow {
  nodeUrl: string;       // https://www.pefa.org/node/<id>
  nodeId: string;
  title: string;         // "Country Year"
  country: string | null;
  year: number | null;
  type: string | null;   // National / Subnational / Climate / Gender
  status: string | null; // Final / Draft / ...
  availability: string | null; // Public / Non-public
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Decode the handful of HTML entities Drupal emits into table cells.
 * pefa.org pages contain things like "Cote d&#039;Ivoire" and "Sao Tome
 * &amp; Principe" — left raw, those bleed straight into our country/title
 * columns and the registry UI. We only need the common subset; full entity
 * decoding would require a DOM parser dep we don't otherwise want here.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Capture text from a Drupal Views td cell. The HTML shape is:
 *   <td class="…views-field-field-<name>">
 *     <div class="label">Label</div>
 *     Value
 *   </td>
 * We skip past the label div and capture the next stretch of plain text.
 */
function readCell(row: string, fieldName: string): string | null {
  const re = new RegExp(
    `views-field-field-${fieldName}[^>]*>[\\s\\S]*?</div>([^<]+)`,
    "i"
  );
  const m = row.match(re);
  return m ? decodeEntities(m[1].trim()) : null;
}

function parseRow(row: string): ParsedRow | null {
  // Title cell: <a href="(absolute or /node/N)">Country Year</a>
  const linkMatch = row.match(
    /href="(?:https?:\/\/[^/]+)?(\/node\/(\d+))"[^>]*>([^<]+)<\/a>/i
  );
  if (!linkMatch) return null;
  const nodeUrl = `${PEFA_BASE}${linkMatch[1]}`;
  const nodeId = linkMatch[2];
  const title = decodeEntities(linkMatch[3].trim());

  const country = readCell(row, "country");
  if (!country) return null; // sidebar / non-table anchors

  const type = readCell(row, "assessment-type");
  const status = readCell(row, "assessment-status");
  const availability = readCell(row, "assessment-availability");
  const yearM = title.match(/\b(19|20)\d{2}\b/);
  const year = yearM ? parseInt(yearM[0], 10) : null;

  return { nodeUrl, nodeId, title, country, year, type, status, availability };
}

async function fetchListPage(pageNum: number): Promise<ParsedRow[]> {
  const url = pageNum === 0 ? PEFA_LIST_URL : `${PEFA_LIST_URL}?page=${pageNum}`;
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`pefa.org page ${pageNum}: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  // Split on <tr>; each chunk is a single row's HTML.
  const chunks = html.split(/<tr\b[^>]*>/i);
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const row = parseRow(chunk);
    if (!row) continue;
    if (seen.has(row.nodeId)) continue;
    seen.add(row.nodeId);
    rows.push(row);
  }
  return rows;
}

function rowToDocument(row: ParsedRow): ScrapedDocument {
  const typeNormalized = (row.type || "national").toLowerCase();
  let category: "national" | "subnational" | "climate" | "gender" = "national";
  if (typeNormalized.includes("subnational")) category = "subnational";
  else if (typeNormalized.includes("climate")) category = "climate";
  else if (typeNormalized.includes("gender")) category = "gender";

  const availability =
    row.availability && /non[- ]public/i.test(row.availability)
      ? "Non-public"
      : "Public";

  const categoryPrefix =
    category === "national" ? "" :
    category === "subnational" ? "Subnational " :
    category === "climate" ? "Climate " :
    "Gender ";
  const yearLabel = row.year ?? "Undated";
  // For national assessments there's exactly one per (country, year), so the
  // country+year filename matches the legacy CSV catalogue's
  // "PEFA <year> <country>.pdf" — letting the scraper-side row dedupe against
  // the CSV-seeded row via the (collection_id, filepath) unique key.
  //
  // For sub-national / climate / gender assessments, a single (country, year)
  // can have many distinct entries (e.g. 12 Tanzanian municipal councils
  // assessed in 2016). Including the pefa.org node id keeps the filename
  // unambiguous and stable across re-runs.
  const filename =
    category === "national"
      ? `PEFA ${yearLabel} ${row.country}.pdf`
      : `PEFA ${categoryPrefix}${yearLabel} ${row.country} (n${row.nodeId}).pdf`;

  return {
    sourceUrl: row.nodeUrl,
    filename,
    title: row.title,
    country: row.country,
    year: row.year,
    tags: {
      category,
      availability,
      is_public: availability === "Public",
    },
    metadata: {
      status: row.status,
      availability,
      is_public: availability === "Public",
      node_id: row.nodeId,
      page_url: row.nodeUrl,
      scraper: "pefa",
      raw_title: row.title,
    },
  };
}

export const pefaScraper: Scraper = {
  name: "pefa",
  collection: "pefa_reports",

  async run(opts: ScraperOptions): Promise<ScraperResult> {
    if (opts.smokeTest) {
      return {
        scraper: "pefa",
        collection: "pefa_reports",
        status: "ok",
        documents: [
          {
            sourceUrl: "https://www.pefa.org/node/0",
            filename: "PEFA 2099 SmokeTest.pdf",
            title: "SmokeTest 2099",
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
    const seenIds = new Set<string>();
    let pagesVisited = 0;
    let lastError: string | undefined;
    let status: ScraperResult["status"] = "ok";

    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const rows = await fetchListPage(page);
        pagesVisited++;

        // Drupal Views serves "empty" pages past the last one. If we got no
        // rows or no new node ids, stop.
        if (rows.length === 0) break;
        const before = documents.length;
        for (const r of rows) {
          if (seenIds.has(r.nodeId)) continue;
          seenIds.add(r.nodeId);
          documents.push(rowToDocument(r));
          if (opts.maxItems && documents.length >= opts.maxItems) break;
        }
        if (documents.length === before) break; // no new IDs => past last page
        if (opts.maxItems && documents.length >= opts.maxItems) break;

        await delay(PAGE_DELAY_MS);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        status = "partial";
        break;
      }
    }

    return {
      scraper: "pefa",
      collection: "pefa_reports",
      status: documents.length === 0 ? (lastError ? "error" : "stub") : status,
      documents,
      errorMessage: lastError,
      metadata: { pages_visited: pagesVisited, source: PEFA_LIST_URL },
    };
  },
};
