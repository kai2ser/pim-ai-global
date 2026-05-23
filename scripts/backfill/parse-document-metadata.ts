/**
 * Backfill country / year / tags.category on the documents registry for
 * pim_literature, pima_reports, wbg_pers — the PEFA collection already has
 * these fields populated (seeded from latest_national_pefas.csv).
 *
 * Strategy per collection:
 *   - pim_literature: only 12 docs, hand-curated table below
 *   - pima_reports:   filename pattern is "IMF - YEAR - COUNTRY - DOC_TYPE.pdf",
 *                     extract via regex
 *   - wbg_pers:       country is a 1-4 word prefix matching a known-country
 *                     dictionary (derived from PEFA docs), year is the first
 *                     4-digit number in 2000-2030 range, category is keyword-
 *                     based ("Sector"/sector noun → 'sector', "PFR"/"PFR1" →
 *                     'pfr', everything else → 'per')
 *
 * Idempotent: only UPDATEs rows where the target field is currently NULL.
 * Safe to re-run.
 *
 * Usage:
 *   npm run backfill:metadata
 *   npm run backfill:metadata -- --dry-run
 *   npm run backfill:metadata -- --collection wbg_pers
 */
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Pool } from "pg";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const flagValue = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};

const DRY_RUN = flag("dry-run");
const COLLECTION_FILTER = flagValue("collection") as
  | "pim_literature"
  | "pima_reports"
  | "wbg_pers"
  | undefined;

const PG_URL = process.env.SUPABASE_DB_URL ?? "";
if (!PG_URL) {
  throw new Error(
    "Missing SUPABASE_DB_URL — set it to the Session-mode pooler URL " +
      "(postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require)"
  );
}

interface ParsedMeta {
  country: string | null;
  year: number | null;
  tags: Record<string, string | boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// pim_literature — hand-curated. These are global PIM-practice documents,
// not country-specific. Country stays NULL; tags carry doc_type + publisher.
// ─────────────────────────────────────────────────────────────────────────────
const PIM_LIT_OVERRIDES: Record<
  string,
  { year: number | null; tags: Record<string, string> }
> = {
  "World Bank InfraGov 2.0 Report 4_280126.pdf": { year: 2026, tags: { publisher: "wb", doc_type: "framework" } },
  "EIB 2023 20220169_economic_appraisal_of_investment_projects_en.pdf": { year: 2023, tags: { publisher: "eib", doc_type: "guidance" } },
  "EC 2021 vademecum_2127_en.pdf": { year: 2021, tags: { publisher: "ec", doc_type: "guidance" } },
  "EC 2014 cba_guide.pdf": { year: 2014, tags: { publisher: "ec", doc_type: "toolkit" } },
  "IMF 2025 Climate PIMA.pdf": { year: 2025, tags: { publisher: "imf", doc_type: "framework" } },
  "Bonner 2022 CBA UQ2c7588c_OA.pdf": { year: 2022, tags: { publisher: "wb", doc_type: "case-study" } },
  "EC 2021 PIM Climate CELEX_52021XC0916(03)_EN_TXT.pdf": { year: 2021, tags: { publisher: "ec", doc_type: "guidance" } },
  "Rajaram et. al 2015 WB The-power-of-public-investment-management-transforming-resources-into-assets-for-growth.pdf": { year: 2015, tags: { publisher: "wb", doc_type: "framework" } },
  "JICA 2018 strengthen_public_investment_management_capacity_handbook_e.pdf": { year: 2018, tags: { publisher: "jica", doc_type: "toolkit" } },
  "World Bank 2022 PIM Climate Smart Reference Guide.pdf": { year: 2022, tags: { publisher: "wb", doc_type: "guidance" } },
};

function parsePimLitFromOverride(filename: string): ParsedMeta {
  const override = PIM_LIT_OVERRIDES[filename];
  if (override) {
    return { country: null, year: override.year, tags: override.tags };
  }

  // Fallback when a new pim_literature doc lands that isn't in the override
  // table. Best-effort: pull year via regex and publisher from the first word.
  const yearMatch = filename.match(/\b(20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  let publisher: string | undefined;
  if (/^IMF\b/i.test(filename)) publisher = "imf";
  else if (/^(World Bank|WB)\b/i.test(filename)) publisher = "wb";
  else if (/^EC\b/i.test(filename)) publisher = "ec";
  else if (/^EIB\b/i.test(filename)) publisher = "eib";
  else if (/^JICA\b/i.test(filename)) publisher = "jica";

  const tags: Record<string, string> = {};
  if (publisher) tags.publisher = publisher;
  return { country: null, year, tags };
}

// ─────────────────────────────────────────────────────────────────────────────
// pima_reports — "IMF - YEAR - COUNTRY - DOC_TYPE.pdf"
// ─────────────────────────────────────────────────────────────────────────────
function parsePimaFilename(filename: string): ParsedMeta {
  // Match "IMF - 2017 - Liberia - PIMA TAR.pdf" or "IMF - 2018 - Bosnia and Herzegovina - PIMA TAR.pdf"
  const m = filename.match(
    /^IMF\s*-\s*(\d{4})\s*-\s*([^-]+?)\s*-\s*(.+?)\.(pdf|docx)$/i
  );
  if (!m) return { country: null, year: null, tags: {} };

  const year = parseInt(m[1], 10);
  const country = m[2].trim();
  const docType = m[3].trim();

  // C-PIMA = Climate PIMA
  let category: "standard" | "climate" | "gender" = "standard";
  if (/\bC-?PIMA\b|Climate/i.test(docType)) category = "climate";
  else if (/\bGender\b/i.test(docType)) category = "gender";

  return {
    country,
    year,
    tags: { category, doc_subtype: docType },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// wbg_pers — variable. Country = matched against known-country dictionary
// (loaded from PEFA docs). Year = first 4-digit 20xx in filename. Category =
// keyword based.
// ─────────────────────────────────────────────────────────────────────────────
const SECTOR_KEYWORDS = [
  "Health",
  "Education",
  "Road",
  "Transport",
  "Energy",
  "Agriculture",
  "Agri",
  "Water",
  "Social",
  "Pension",
  "Fiscal Risk",
  "Climate",
  "Gender",
];

function parseWbgPersFilename(
  filename: string,
  knownCountries: string[]
): ParsedMeta {
  // Year: first 4-digit 20xx in the filename
  const yearMatch = filename.match(/\b(20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Country: longest known-country string that matches the filename's prefix
  // (longest-first so "Papua New Guinea" beats "Papua").
  const sortedCountries = [...knownCountries].sort((a, b) => b.length - a.length);
  let country: string | null = null;
  for (const c of sortedCountries) {
    // Match "Country " or "Country-" or "Country_" at start, case-insensitive
    const re = new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\-_]`, "i");
    if (re.test(filename)) {
      country = c;
      break;
    }
  }

  // Category — sector if a sector keyword is in the filename, else per/pfr by acronym
  let category: "per" | "pfr" | "sector" = "per";
  if (SECTOR_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, "i").test(filename))) {
    category = "sector";
  } else if (/\bPFR\d?\b/i.test(filename)) {
    category = "pfr";
  }

  return { country, year, tags: { category } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const u = new URL(PG_URL);
  const pool = new Pool({
    host: u.hostname,
    port: Number(u.port),
    database: u.pathname.slice(1),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  console.log(`Backfill mode: ${DRY_RUN ? "DRY RUN" : "WRITE"}`);
  if (COLLECTION_FILTER) console.log(`Collection filter: ${COLLECTION_FILTER}`);

  // Load known countries from PEFA docs to use as wbg_pers country dictionary
  const { rows: countryRows } = await pool.query<{ country: string }>(
    `SELECT DISTINCT country FROM documents
     WHERE collection_id = 'pefa_reports' AND country IS NOT NULL
     ORDER BY country`
  );
  const knownCountries = countryRows.map((r) => r.country);
  console.log(`Loaded ${knownCountries.length} known countries from PEFA registry\n`);

  const COLLECTIONS: Array<{
    id: "pim_literature" | "pima_reports" | "wbg_pers";
    parse: (filename: string) => ParsedMeta;
  }> = [
    { id: "pim_literature", parse: parsePimLitFromOverride },
    { id: "pima_reports", parse: parsePimaFilename },
    { id: "wbg_pers", parse: (f) => parseWbgPersFilename(f, knownCountries) },
  ];

  let grand = { updated: 0, skipped: 0, unparseable: 0 };

  try {
    for (const col of COLLECTIONS) {
      if (COLLECTION_FILTER && col.id !== COLLECTION_FILTER) continue;

      console.log(`=== ${col.id} ===`);
      // Pull rows that still need backfilling.
      const { rows } = await pool.query<{
        id: string;
        filename: string;
        country: string | null;
        year: number | null;
        tags: Record<string, unknown>;
      }>(
        `SELECT id, filename, country, year, tags
         FROM documents
         WHERE collection_id = $1
           AND (country IS NULL OR year IS NULL OR tags = '{}'::jsonb OR tags IS NULL)`,
        [col.id]
      );

      let updated = 0;
      let skipped = 0;
      let unparseable = 0;

      for (const row of rows) {
        const parsed = col.parse(row.filename);
        if (!parsed.country && !parsed.year && Object.keys(parsed.tags).length === 0) {
          unparseable++;
          if (unparseable <= 3) console.log(`  unparseable: ${row.filename}`);
          continue;
        }

        // Only overwrite NULL fields; never clobber existing values.
        const newCountry = row.country ?? parsed.country;
        const newYear = row.year ?? parsed.year;
        const existingTags = row.tags || {};
        const newTags = { ...parsed.tags, ...existingTags };

        if (DRY_RUN) {
          updated++;
          if (updated <= 5) {
            console.log(
              `  would update: ${row.filename}  → country=${newCountry} year=${newYear} tags=${JSON.stringify(newTags)}`
            );
          }
          continue;
        }

        const res = await pool.query(
          `UPDATE documents SET country = $1, year = $2, tags = $3::jsonb WHERE id = $4`,
          [newCountry, newYear, JSON.stringify(newTags), row.id]
        );
        if ((res.rowCount ?? 0) > 0) updated++;
        else skipped++;
      }

      console.log(
        `  total=${rows.length}  updated=${updated}  unparseable=${unparseable}  skipped=${skipped}\n`
      );
      grand.updated += updated;
      grand.unparseable += unparseable;
      grand.skipped += skipped;
    }

    console.log(`\n=== Done ===\n  updated=${grand.updated}  unparseable=${grand.unparseable}  skipped=${grand.skipped}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
