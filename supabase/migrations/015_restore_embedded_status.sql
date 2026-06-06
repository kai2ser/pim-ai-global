-- =============================================================================
-- 015: One-time housekeeping — restore ingestion_status='embedded' for rows
--      whose chunks already exist.
--
-- BACKGROUND
-- The scraper orchestrator's upsert (pre-PR #16) stamped
-- ingestion_status='catalogued' onto every row touched by a cron refresh,
-- including rows that had previously been promoted to 'embedded'. The chunks
-- themselves were never deleted (the ingest pipeline owns those), but the
-- documents-row flag was reset, making the registry UI under-report what's
-- queryable and forcing the bulk-ingest script to re-attempt work that was
-- already done.
--
-- The June 1 2026 cron triggered this for the recently-ingested PIMA + WBG
-- + PEFA docs. PR #16 fixes the orchestrator so future cron runs don't
-- regress. This migration repairs the rows already in the bad state.
--
-- For each of the four chunk tables, flip
--   ingestion_status: 'catalogued' → 'embedded'
-- where the matching documents row's id appears at least once in the chunk
-- table. Other ingestion_status values ('excluded', 'failed', etc.) are
-- left alone.
--
-- Idempotent: re-running this migration is a no-op (the WHERE filter only
-- matches rows that are still in the broken state).
-- =============================================================================

UPDATE documents d
SET ingestion_status = 'embedded'
WHERE d.collection_id = 'pefa_reports'
  AND d.ingestion_status = 'catalogued'
  AND EXISTS (SELECT 1 FROM pefa_reports c WHERE c.document_id = d.id);

UPDATE documents d
SET ingestion_status = 'embedded'
WHERE d.collection_id = 'pima_reports'
  AND d.ingestion_status = 'catalogued'
  AND EXISTS (SELECT 1 FROM pima_reports c WHERE c.document_id = d.id);

UPDATE documents d
SET ingestion_status = 'embedded'
WHERE d.collection_id = 'wbg_pers'
  AND d.ingestion_status = 'catalogued'
  AND EXISTS (SELECT 1 FROM wbg_pers c WHERE c.document_id = d.id);

UPDATE documents d
SET ingestion_status = 'embedded'
WHERE d.collection_id = 'pim_literature'
  AND d.ingestion_status = 'catalogued'
  AND EXISTS (SELECT 1 FROM pim_literature c WHERE c.document_id = d.id);

-- Also refresh chunk_count for the restored rows so the registry UI shows
-- the actual numbers (the orchestrator had stamped chunk_count=0 too).
UPDATE documents d
SET chunk_count = (
  SELECT COUNT(*) FROM pefa_reports c WHERE c.document_id = d.id
)
WHERE d.collection_id = 'pefa_reports'
  AND d.ingestion_status = 'embedded'
  AND d.chunk_count = 0;

UPDATE documents d
SET chunk_count = (
  SELECT COUNT(*) FROM pima_reports c WHERE c.document_id = d.id
)
WHERE d.collection_id = 'pima_reports'
  AND d.ingestion_status = 'embedded'
  AND d.chunk_count = 0;

UPDATE documents d
SET chunk_count = (
  SELECT COUNT(*) FROM wbg_pers c WHERE c.document_id = d.id
)
WHERE d.collection_id = 'wbg_pers'
  AND d.ingestion_status = 'embedded'
  AND d.chunk_count = 0;

UPDATE documents d
SET chunk_count = (
  SELECT COUNT(*) FROM pim_literature c WHERE c.document_id = d.id
)
WHERE d.collection_id = 'pim_literature'
  AND d.ingestion_status = 'embedded'
  AND d.chunk_count = 0;

-- Sanity: report how many rows still look broken (chunks exist but flag !=
-- embedded). Should be zero after the UPDATEs above.
DO $$
DECLARE
  mismatch_count INT;
BEGIN
  SELECT COUNT(*) INTO mismatch_count FROM (
    SELECT d.id FROM documents d
    WHERE d.collection_id = 'pefa_reports'
      AND d.ingestion_status != 'embedded'
      AND EXISTS (SELECT 1 FROM pefa_reports c WHERE c.document_id = d.id)
    UNION ALL
    SELECT d.id FROM documents d
    WHERE d.collection_id = 'pima_reports'
      AND d.ingestion_status != 'embedded'
      AND EXISTS (SELECT 1 FROM pima_reports c WHERE c.document_id = d.id)
    UNION ALL
    SELECT d.id FROM documents d
    WHERE d.collection_id = 'wbg_pers'
      AND d.ingestion_status != 'embedded'
      AND EXISTS (SELECT 1 FROM wbg_pers c WHERE c.document_id = d.id)
    UNION ALL
    SELECT d.id FROM documents d
    WHERE d.collection_id = 'pim_literature'
      AND d.ingestion_status != 'embedded'
      AND EXISTS (SELECT 1 FROM pim_literature c WHERE c.document_id = d.id)
  ) mismatches;
  IF mismatch_count > 0 THEN
    RAISE WARNING '015_restore_embedded_status: % docs still have chunks but ingestion_status != embedded (likely status=excluded or failed — leave alone)', mismatch_count;
  END IF;
END $$;
