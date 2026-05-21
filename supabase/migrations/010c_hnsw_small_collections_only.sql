-- =============================================================================
-- 010c: HNSW indexes for the three small chunk tables only.
--
-- Migration 010b builds HNSW indexes for all four collections, but the
-- wbg_pers build (125k × halfvec(3072)) consistently OOMs on Supabase Nano's
-- maintenance_work_mem cap and leaves the connection pool wedged.
--
-- This migration is the safe subset: it builds HNSW only on the 3 small
-- collections (pim_literature 8k, pima_reports 14k, pefa_reports 14k) which
-- complete in seconds each on Nano. wbg_pers stays on sequential cosine scan
-- until the project is upgraded to a tier with enough work_mem (Small / 1GB+).
--
-- CONCURRENTLY = each CREATE INDEX runs as its own connection, no transaction,
-- doesn't block reads or writes. Run with psql -f, NOT inside \BEGIN.
-- Each statement is idempotent (IF NOT EXISTS).
-- =============================================================================

-- NB: Supabase Nano's shared-memory segment caps maintenance_work_mem well
-- below the documented postgres limit. 512MB requests fail with "could not
-- resize shared memory segment: No space left on device". 128MB fits, and
-- m=8 / ef_construction=32 keeps the HNSW graph small enough for the 8-14k
-- row tables here. The recall/quality difference vs m=16/ef=64 is negligible
-- at this scale.
SET maintenance_work_mem = '128MB';

CREATE INDEX CONCURRENTLY IF NOT EXISTS pim_literature_embedding_hnsw_idx
  ON pim_literature USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 8, ef_construction = 32);

CREATE INDEX CONCURRENTLY IF NOT EXISTS pima_reports_embedding_hnsw_idx
  ON pima_reports USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 8, ef_construction = 32);

CREATE INDEX CONCURRENTLY IF NOT EXISTS pefa_reports_embedding_hnsw_idx
  ON pefa_reports USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 8, ef_construction = 32);

-- wbg_pers is intentionally skipped here. To enable it later (after upgrading
-- compute tier), apply migration 010b — it's safe to re-run because the three
-- indexes above use CREATE INDEX IF NOT EXISTS.
