/**
 * World Bank Open Knowledge Repository scraper.
 *
 * Uses the DSpace 7 discover API to list canonical Public Expenditure Reviews
 * and Public Finance Reviews. Each hit carries enough metadata in-band that
 * we don't need to follow up with item-detail fetches:
 *   - dc.title           → title
 *   - dc.date.issued     → year
 *   - okr.region.country → country
 *   - okr.doctype        → category (per | pfr)
 *   - okr.pdfurl         → direct PDF download URL (becomes source_url)
 *
 * Why the doctype facet rather than a phrase query: doctype is curated WB
 * metadata, ~27 official PERs total, with high precision. Phrase queries
 * recall thousands of full-text hits (PERs cited inside other docs) and
 * pollute the registry. The 316 historical rows in wbg_pers were imported
 * via a broader hand-curated set; this scraper's job is to surface *new*
 * canonical PERs in the cron.
 */

import type { Scraper, ScraperOptions, ScraperResult, ScrapedDocument } from "./types";

const OKR_BASE = "https://openknowledge.worldbank.org";
const OKR_DISCOVER = `${OKR_BASE}/server/api/discover/search/objects`;
const USER_AGENT =
  "pim-ai-global-bot/1.0 (research; +https://pim-ai-global.vercel.app)";
const PAGE_DELAY_MS = 500;
const PAGE_SIZE = 50;
const MAX_PAGES = 20; // safety cap (~1000 results)

interface OkrMetadataValue {
  value: string;
  language?: string | null;
  place?: number;
}

interface OkrIndexableObject {
  uuid: string;
  handle: string;
  name?: string;
  metadata: Record<string, OkrMetadataValue[] | undefined>;
}

interface OkrSearchObject {
  _embedded?: {
    indexableObject?: OkrIndexableObject;
  };
}

interface OkrSearchResult {
  _embedded?: {
    searchResult?: {
      page?: { number: number; size: number; totalPages: number; totalElements: number };
      _embedded?: { objects?: OkrSearchObject[] };
      _links?: { next?: { href?: string } };
    };
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pick the best entry from a multi-language metadata array.
 * Prefers English; falls back to the first place=0 entry; else first.
 */
function preferEnglish(arr: OkrMetadataValue[] | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  const en = arr.find((v) => v.language === "en");
  if (en) return en.value;
  const place0 = arr.find((v) => (v.place ?? 0) === 0);
  return (place0 ?? arr[0]).value;
}

function allValues(arr: OkrMetadataValue[] | undefined): string[] {
  return (arr ?? []).map((v) => v.value).filter(Boolean);
}

function classifyDoctype(doctypes: string[]): "per" | "pfr" | "sector" {
  const lower = doctypes.map((d) => d.toLowerCase());
  if (lower.some((d) => d.includes("public expenditure review"))) return "per";
  if (lower.some((d) => d.includes("public finance review"))) return "pfr";
  return "sector"; // fallback bucket for other PFM-ish doctypes
}

function itemToDocument(item: OkrIndexableObject): ScrapedDocument | null {
  const title = preferEnglish(item.metadata["dc.title"]);
  if (!title) return null;

  const pdfUrl = preferEnglish(item.metadata["okr.pdfurl"]);
  // Without a direct PDF URL we'd have to walk bitstreams to ingest later,
  // and the registry's whole point is searchable + downloadable PDFs.
  // Skip rows without one rather than catalogue something we can't ingest.
  if (!pdfUrl) return null;

  const dateIssued = preferEnglish(item.metadata["dc.date.issued"]);
  const yearMatch = dateIssued ? dateIssued.match(/^\d{4}/) : null;
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;

  const countries = allValues(item.metadata["okr.region.country"]);
  const country = countries.length > 0 ? countries[0] : null;

  const doctypes = allValues(item.metadata["okr.doctype"]);
  const category = classifyDoctype(doctypes);

  // Filename mirrors the registry convention used elsewhere:
  //   "World Bank PER <year> <country>.pdf"
  // For non-PER doctypes use the literal doctype slug. Include the OKR
  // handle in the filename so multiple PERs for the same (country,year)
  // — they exist — don't collide via the (collection_id, filepath) key.
  const yearLabel = year ?? "Undated";
  const countryLabel = country ?? "Multi-country";
  const prefix =
    category === "per" ? "PER" : category === "pfr" ? "PFR" : "Sector";
  const handleSlug = item.handle ? item.handle.replace("/", "-") : item.uuid;
  const filename = `World Bank ${prefix} ${yearLabel} ${countryLabel} (${handleSlug}).pdf`;

  return {
    sourceUrl: pdfUrl,
    filename,
    title,
    country,
    year,
    tags: {
      category,
      doctype: doctypes[0] ?? "unknown",
    },
    metadata: {
      okr_uuid: item.uuid,
      okr_handle: item.handle,
      handle_url: item.handle ? `https://hdl.handle.net/${item.handle}` : null,
      abstract: preferEnglish(item.metadata["dc.description.abstract"]),
      countries,
      doctypes,
      txt_url: preferEnglish(item.metadata["okr.txturl"]),
      scraper: "wbg",
    },
  };
}

async function fetchDoctypePage(
  doctype: string,
  pageNum: number
): Promise<{ objects: OkrIndexableObject[]; hasNext: boolean; total: number }> {
  const params = new URLSearchParams({
    query: "*",
    dsoType: "item",
    size: String(PAGE_SIZE),
    page: String(pageNum),
    "f.doctype": `${doctype},equals`,
  });
  const url = `${OKR_DISCOVER}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`OKR ${doctype} page ${pageNum}: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as OkrSearchResult;
  const sr = json._embedded?.searchResult;
  const objects: OkrIndexableObject[] = [];
  for (const obj of sr?._embedded?.objects ?? []) {
    const item = obj._embedded?.indexableObject;
    if (item) objects.push(item);
  }
  const hasNext = Boolean(sr?._links?.next?.href);
  const total = sr?.page?.totalElements ?? objects.length;
  return { objects, hasNext, total };
}

export const wbgScraper: Scraper = {
  name: "wbg",
  collection: "wbg_pers",

  async run(opts: ScraperOptions): Promise<ScraperResult> {
    if (opts.smokeTest) {
      return {
        scraper: "wbg",
        collection: "wbg_pers",
        status: "ok",
        documents: [
          {
            sourceUrl: "https://documents.worldbank.org/smoke.pdf",
            filename: "World Bank PER 2099 SmokeTest (smoke).pdf",
            title: "SmokeTest PER",
            country: "SmokeTest",
            year: 2099,
            tags: { category: "per", doctype: "Public Expenditure Review" },
            metadata: { scraper: "wbg", smoke: true },
          },
        ],
        metadata: { mode: "smoke_test" },
      };
    }

    // Pull canonical PERs and PFRs. These are small, curated facet buckets
    // (~27 + 1 entries today); we don't expect more than 1–2 pages each.
    const doctypes = ["Public Expenditure Review", "Public Finance Review"];
    const documents: ScrapedDocument[] = [];
    const seenIds = new Set<string>();
    let pagesVisited = 0;
    let lastError: string | undefined;
    let status: ScraperResult["status"] = "ok";
    const perDoctype: Record<string, number> = {};

    outer: for (const doctype of doctypes) {
      perDoctype[doctype] = 0;
      for (let p = 0; p < MAX_PAGES; p++) {
        try {
          const { objects, hasNext } = await fetchDoctypePage(doctype, p);
          pagesVisited++;
          if (objects.length === 0) break;
          for (const item of objects) {
            if (seenIds.has(item.uuid)) continue;
            seenIds.add(item.uuid);
            const doc = itemToDocument(item);
            if (doc) {
              documents.push(doc);
              perDoctype[doctype]++;
              if (opts.maxItems && documents.length >= opts.maxItems) break outer;
            }
          }
          if (!hasNext) break;
          await delay(PAGE_DELAY_MS);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          status = "partial";
          break outer;
        }
      }
    }

    return {
      scraper: "wbg",
      collection: "wbg_pers",
      status: documents.length === 0 ? (lastError ? "error" : "stub") : status,
      documents,
      errorMessage: lastError,
      metadata: {
        pages_visited: pagesVisited,
        source: OKR_DISCOVER,
        per_doctype: perDoctype,
      },
    };
  },
};
