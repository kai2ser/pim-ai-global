/**
 * World Bank Public Expenditure / Public Finance Reviews scraper — STUB.
 *
 * Returns an empty result with status='stub' until implemented.
 *
 * Implementation plan when this lands:
 *   - Source: World Bank Open Knowledge Repository API
 *     https://openknowledge.worldbank.org/server/api/discover/search/objects
 *     ?query=public%20expenditure%20review&dsoType=item&size=50
 *     Returns JSON; each hit has title, abstract, year, country tags, and
 *     download URLs.
 *   - Approach: paginate the API; for each hit, classify the document type
 *     (PER / PFR / sector-specific) from title keywords; extract country
 *     from item.metadata['dc.coverage.country'] or similar field.
 *   - Dedupe key: source_url (the OKR item URL).
 *   - Expected output: ~316 rows already catalogued via hand-curated import;
 *     scraper should surface new releases.
 *   - Bonus: OKR API is more reliable than HTML scraping; safer in cron.
 */

import type { Scraper, ScraperResult } from "./types";

export const wbgScraper: Scraper = {
  name: "wbg",
  collection: "wbg_pers",

  async run(): Promise<ScraperResult> {
    return {
      scraper: "wbg",
      collection: "wbg_pers",
      status: "stub",
      documents: [],
      metadata: {
        note: "World Bank scraper not yet implemented — see src/lib/scrapers/wbg.ts header for the plan.",
      },
    };
  },
};
