/**
 * IMF PIMA scraper — STUB.
 *
 * Returns an empty result with status='stub' so the cron + admin UI
 * surface "scraper not yet implemented" rather than silently doing nothing.
 *
 * Implementation plan when this lands:
 *   - Source: https://www.imf.org/en/Topics/PFM/PIMA
 *     Lists country PIMA assessments with year + report-type labels
 *     (PIMA Summary / PIMA TAR / C-PIMA = Climate PIMA / Gender PIMA).
 *   - Approach: same pattern as pefa.ts — fetch list page(s), regex out
 *     anchor links to country-specific PIMA pages, parse country/year/
 *     category from the surrounding row text.
 *   - Dedupe key: source_url (the IMF country PIMA landing page).
 *   - Expected output: ~110+ rows (we already have 107 catalogued; the
 *     scraper should surface new releases as they land).
 */

import type { Scraper, ScraperResult } from "./types";

export const pimaScraper: Scraper = {
  name: "pima",
  collection: "pima_reports",

  async run(): Promise<ScraperResult> {
    return {
      scraper: "pima",
      collection: "pima_reports",
      status: "stub",
      documents: [],
      metadata: {
        note: "IMF PIMA scraper not yet implemented — see src/lib/scrapers/pima.ts header for the plan.",
      },
    };
  },
};
