/**
 * IMF Public Investment Management Assessment (PIMA) scraper.
 *
 * The IMF maintains a dedicated AEM-rendered portal at
 *   https://infrastructuregovern.imf.org/content/PIMA/Home/Region-and-Country-Information.html
 * which lists every country with a published PIMA, and one country page per
 * country that links the PDF(s) plus a mission-date table.
 *
 * Why this URL and not /en/Publications/Search: the publications search is a
 * Next.js + Coveo SPA; server-rendered HTML is an empty shell with zero rows.
 * The Coveo REST endpoint requires a client-side-minted access token. The
 * dedicated PIMA portal is plain AEM HTML, no JS required, ~113 country
 * pages total — paginated as N+1 fetches (1 index + 113 leaves).
 *
 * Categories mapped from the link text:
 *   PIMA Technical Assistance Report           → standard / full
 *   PIMA Country Summary Assessment            → standard / summary
 *   C-PIMA Technical Assistance Report         → climate  / full
 *   C-PIMA Country Summary Assessment          → climate  / summary
 *
 * Filename convention (uniqueness-safe under (collection_id, filepath)):
 *   "PIMA <year> <Country>.pdf"             for standard full
 *   "PIMA Summary <year> <Country>.pdf"     for standard summary
 *   "C-PIMA <year> <Country>.pdf"           for climate full
 *   "C-PIMA Summary <year> <Country>.pdf"   for climate summary
 *
 * If multiple reports of the same (kind, year, country) exist (uncommon),
 * we append the PDF basename hash to keep the unique constraint happy.
 */

import type { Scraper, ScraperOptions, ScraperResult, ScrapedDocument } from "./types";

const IMF_BASE = "https://infrastructuregovern.imf.org";
const INDEX_URL = `${IMF_BASE}/content/PIMA/Home/Region-and-Country-Information.html`;
const USER_AGENT =
  "pim-ai-global-bot/1.0 (research; +https://pim-ai-global.vercel.app)";
const PAGE_DELAY_MS = 250;
const MAX_COUNTRIES = 200; // safety cap; portal currently lists ~113

interface CountryLink {
  url: string;     // absolute URL to the country page
  slug: string;    // path component, e.g. "Burkina-Faso" or "cabo-verde"
  country: string; // human-readable form derived from slug
}

interface PimaReport {
  category: "standard" | "climate";
  type: "full" | "summary";
  title: string;       // link text from the IMF page
  pdfUrl: string;      // absolute, https://infrastructuregovern.imf.org/...
  pdfBasename: string; // for filename collision suffix
}

interface CountryMissionDates {
  pima?: string;   // e.g. "June 2022"
  cpima?: string;
  pimaYear?: number;
  cpimaYear?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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
 * Turn a URL slug like "Burkina-Faso" or "cabo-verde" into "Burkina Faso" /
 * "Cabo Verde". The IMF portal is inconsistent about casing, so we Title-
 * case manually.
 */
function slugToCountry(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function parseCountryIndex(html: string): CountryLink[] {
  const re = /href="(\/content\/PIMA\/Home\/Region-and-Country-Information\/Countries\/([^"]+)\.html)"/gi;
  const seen = new Set<string>();
  const out: CountryLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    const slug = m[2];
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({
      url: `${IMF_BASE}${path}`,
      slug,
      country: slugToCountry(slug),
    });
  }
  return out;
}

function parsePimaReports(html: string): PimaReport[] {
  // Each report is an <a href="/content/dam/PIMA/Countries/<slug>/Documents/<File>.pdf">Title</a>
  const re = /<a[^>]*href="(\/content\/dam\/PIMA\/Countries\/[^"]+\.pdf)"[^>]*>([^<]+)<\/a>/gi;
  const reports: PimaReport[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const pdfPath = m[1];
    const titleRaw = decodeEntities(m[2].trim());

    // Skip ancillary docs (the portal occasionally links background pubs).
    const lower = titleRaw.toLowerCase();
    const isClimate = lower.includes("c-pima") || lower.startsWith("c‑pima");
    const isSummary = lower.includes("summary");
    const isTechnical = lower.includes("technical assistance");
    if (!isClimate && !isSummary && !isTechnical) continue;

    const pdfUrl = `${IMF_BASE}${pdfPath}`;
    const pdfBasename = pdfPath.split("/").pop()!.replace(/\.pdf$/i, "");

    reports.push({
      category: isClimate ? "climate" : "standard",
      type: isSummary ? "summary" : "full",
      title: titleRaw,
      pdfUrl,
      pdfBasename,
    });
  }
  return reports;
}

function parseMissionDates(html: string): CountryMissionDates {
  const out: CountryMissionDates = {};
  // Engagements table row: <tr><td>...PIMA...</td><td>Month YYYY</td></tr>
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const label = decodeEntities(m[1].replace(/<[^>]+>/g, "").trim());
    const dateText = decodeEntities(m[2].replace(/<[^>]+>/g, "").trim());
    if (!dateText) continue;
    const yearMatch = dateText.match(/\b(19|20)\d{2}\b/);
    const yr = yearMatch ? parseInt(yearMatch[0], 10) : undefined;
    const labelLower = label.toLowerCase();
    if (labelLower.includes("climate pima") || labelLower.includes("c-pima") || labelLower.includes("c‑pima")) {
      out.cpima = dateText;
      out.cpimaYear = yr;
    } else if (labelLower.startsWith("public investment management assessment") || labelLower === "pima") {
      out.pima = dateText;
      out.pimaYear = yr;
    }
  }
  return out;
}

function reportToDocument(
  country: string,
  countryUrl: string,
  rep: PimaReport,
  dates: CountryMissionDates
): ScrapedDocument {
  const year = rep.category === "climate" ? dates.cpimaYear ?? null : dates.pimaYear ?? null;
  const yearLabel = year ?? "Undated";

  // Filename — see file header for the convention. The PDF basename is
  // appended only when needed to disambiguate the rare case of multiple
  // reports of the same (kind, year, country).
  const prefix =
    rep.category === "climate"
      ? rep.type === "summary"
        ? "C-PIMA Summary"
        : "C-PIMA"
      : rep.type === "summary"
        ? "PIMA Summary"
        : "PIMA";
  const filename = `${prefix} ${yearLabel} ${country} (${rep.pdfBasename}).pdf`;

  return {
    sourceUrl: rep.pdfUrl,
    filename,
    title: rep.title,
    country,
    year,
    tags: {
      category: rep.category, // 'standard' | 'climate'
      report_type: rep.type,  // 'full' | 'summary'
    },
    metadata: {
      pdf_url: rep.pdfUrl,
      pdf_basename: rep.pdfBasename,
      country_page_url: countryUrl,
      mission_date: rep.category === "climate" ? dates.cpima : dates.pima,
      scraper: "pima",
    },
  };
}

export const pimaScraper: Scraper = {
  name: "pima",
  collection: "pima_reports",

  async run(opts: ScraperOptions): Promise<ScraperResult> {
    if (opts.smokeTest) {
      return {
        scraper: "pima",
        collection: "pima_reports",
        status: "ok",
        documents: [
          {
            sourceUrl: `${IMF_BASE}/content/dam/PIMA/Countries/SmokeTest/Documents/smoke.pdf`,
            filename: "PIMA 2099 SmokeTest (smoke).pdf",
            title: "PIMA Technical Assistance Report — SmokeTest 2099",
            country: "SmokeTest",
            year: 2099,
            tags: { category: "standard", report_type: "full" },
            metadata: { scraper: "pima", smoke: true },
          },
        ],
        metadata: { mode: "smoke_test" },
      };
    }

    const documents: ScrapedDocument[] = [];
    let pagesVisited = 0;
    let lastError: string | undefined;
    let status: ScraperResult["status"] = "ok";
    let countriesScanned = 0;
    let countriesWithReports = 0;

    let countryLinks: CountryLink[] = [];
    try {
      const indexHtml = await fetchHtml(INDEX_URL);
      pagesVisited++;
      countryLinks = parseCountryIndex(indexHtml);
    } catch (e) {
      return {
        scraper: "pima",
        collection: "pima_reports",
        status: "error",
        documents: [],
        errorMessage: e instanceof Error ? e.message : String(e),
        metadata: { pages_visited: pagesVisited, source: INDEX_URL },
      };
    }

    if (countryLinks.length === 0) {
      return {
        scraper: "pima",
        collection: "pima_reports",
        status: "error",
        documents: [],
        errorMessage: "PIMA portal index returned 0 country links — selector may have changed.",
        metadata: { pages_visited: pagesVisited, source: INDEX_URL },
      };
    }

    for (const c of countryLinks.slice(0, MAX_COUNTRIES)) {
      try {
        const html = await fetchHtml(c.url);
        pagesVisited++;
        countriesScanned++;
        const reports = parsePimaReports(html);
        const dates = parseMissionDates(html);
        if (reports.length > 0) countriesWithReports++;
        for (const rep of reports) {
          documents.push(reportToDocument(c.country, c.url, rep, dates));
          if (opts.maxItems && documents.length >= opts.maxItems) break;
        }
        if (opts.maxItems && documents.length >= opts.maxItems) break;
        await delay(PAGE_DELAY_MS);
      } catch (e) {
        // Don't abort the whole run on one country page; just record and
        // move on. Status downgrades to 'partial'.
        lastError = e instanceof Error ? e.message : String(e);
        status = "partial";
        continue;
      }
    }

    return {
      scraper: "pima",
      collection: "pima_reports",
      status: documents.length === 0 ? (lastError ? "error" : "stub") : status,
      documents,
      errorMessage: lastError,
      metadata: {
        pages_visited: pagesVisited,
        countries_scanned: countriesScanned,
        countries_with_reports: countriesWithReports,
        source: INDEX_URL,
      },
    };
  },
};
