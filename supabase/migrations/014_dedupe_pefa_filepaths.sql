-- =============================================================================
-- 014: Normalize PEFA filepaths + dedupe scraper-vs-CSV overlap.
--
-- BACKGROUND
-- The PEFA collection has two "generations" of rows in `documents`:
--   1. CSV-seeded (the original 148 from latest_national_pefas.csv) with
--      filepath = '_dataPEFA/PEFA <year> <country>.pdf'
--      and chunks already embedded in pefa_reports.
--   2. Scraper-added (~900 from PR #8) with
--      filepath = 'https://www.pefa.org/node/<nodeId>'
--      and no chunks (ingestion_status = 'catalogued').
--
-- The UNIQUE constraint is (collection_id, filepath), so the two filepath
-- formats never collide — same assessment ends up as two rows. /registry
-- shows "Cabo Verde 2026" twice, etc.
--
-- FIX
-- Canonical filepath = filename (i.e. 'PEFA <year> <country>.pdf' for
-- national; 'PEFA Subnational <year> <country> (n<nodeId>).pdf' for the
-- many-per-bucket sub-national / climate / gender entries). This migration:
--   A. Normalizes CSV rows: drop the '_dataPEFA/' prefix.
--   B. For each scraper row that matches an existing CSV row on filename:
--      copies source_url + tags onto the CSV row, then deletes the scraper
--      row. The CSV row keeps its id (preserving FK references from
--      pefa_reports.document_id → documents.id and the embedded chunks).
--   C. Deletes the remaining scraper-URL rows. The companion pefa.ts
--      change in this PR adds node_id to non-national filenames; the next
--      /admin (or cron) run will repopulate them with the new, unique
--      filenames. These rows are catalogue-only (no chunks), so nothing
--      embedded is lost.
--
-- Companion change: src/lib/scrapers/index.ts switches to filepath=filename
-- so future cron/admin runs dedupe naturally via (collection_id, filepath).
--
-- Operator step after applying: hit /admin → "Refresh registry" once, so
-- the deleted sub-national/climate/gender rows are recreated with the new
-- disambiguated filenames before the next monthly cron.
--
-- Idempotent: re-running this migration is a no-op (no rows match the
-- LIKE patterns the second time).
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. Normalize CSV-seeded PEFA rows: strip '_dataPEFA/' prefix from filepath.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE documents
SET filepath = filename
WHERE collection_id = 'pefa_reports'
  AND filepath LIKE '\_dataPEFA/%' ESCAPE '\';

-- ────────────────────────────────────────────────────────────────────────────
-- B. Merge scraper-added rows that duplicate CSV rows by filename.
-- ────────────────────────────────────────────────────────────────────────────

-- B1. Copy scraper-side source_url + tags onto the CSV row (where the CSV
--     row doesn't already have them). Match on (collection_id, filename) —
--     after step A, filepath==filename for CSV rows, so this is also the
--     natural dedupe key.
UPDATE documents csv_row
SET source_url = COALESCE(csv_row.source_url, scraper_row.source_url),
    tags       = csv_row.tags || (scraper_row.tags - 'is_public' - 'availability')
FROM documents scraper_row
WHERE csv_row.collection_id = 'pefa_reports'
  AND scraper_row.collection_id = 'pefa_reports'
  AND csv_row.id != scraper_row.id
  AND csv_row.filename = scraper_row.filename
  AND scraper_row.filepath LIKE 'https://www.pefa.org/%';

-- B2. Delete the now-redundant scraper-side rows.
DELETE FROM documents
WHERE collection_id = 'pefa_reports'
  AND filepath LIKE 'https://www.pefa.org/%'
  AND EXISTS (
    SELECT 1 FROM documents csv_row
    WHERE csv_row.collection_id = 'pefa_reports'
      AND csv_row.id != documents.id
      AND csv_row.filename = documents.filename
      AND csv_row.filepath NOT LIKE 'https://%'
  );

-- ────────────────────────────────────────────────────────────────────────────
-- C. Drop the remaining scraper-URL rows.
--
-- After step B these are sub-national / climate / gender assessments with
-- *no* CSV twin. We can't just rewrite filepath = filename like for the CSV
-- rows: the original scraper produced collision-prone filenames (e.g. 12
-- distinct Tanzanian municipal assessments in 2016 all become "PEFA
-- Subnational 2016 Tanzania.pdf"), so we'd fall foul of the unique
-- (collection_id, filepath) constraint.
--
-- The companion src/lib/scrapers/pefa.ts change in this PR adds node_id to
-- the filename for non-national assessments, making them unique. Deleting
-- these stale rows here lets the next /admin (or cron) run repopulate them
-- with the new disambiguated filenames.
--
-- These rows are catalogued-only (no chunks, no FK references from
-- pefa_reports), so dropping them is safe — no embeddings are lost.
-- ────────────────────────────────────────────────────────────────────────────
DELETE FROM documents
WHERE collection_id = 'pefa_reports'
  AND filepath LIKE 'https://www.pefa.org/%';

-- ────────────────────────────────────────────────────────────────────────────
-- Sanity: verify no two pefa_reports rows share the same (collection_id, filepath).
-- The UNIQUE constraint enforces this; the SELECT below is just a noisy
-- assertion you can read in the migration output.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT 1
    FROM documents
    WHERE collection_id = 'pefa_reports'
    GROUP BY collection_id, filepath
    HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE WARNING '014_dedupe_pefa_filepaths: % duplicate (collection,filepath) groups remain in pefa_reports', dup_count;
  END IF;
END $$;
