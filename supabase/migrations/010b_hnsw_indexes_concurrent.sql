-- =============================================================================
-- 010b: HNSW indexes for halfvec(3072) embeddings — built CONCURRENTLY so they
-- don't block reads/writes and don't hold a long transaction.
--
-- IMPORTANT: Each CREATE INDEX CONCURRENTLY statement must run on its own,
-- OUTSIDE any transaction. Run this file with psql -f, NOT inside a \BEGIN.
-- psql will issue each statement in autocommit mode by default.
--
-- On the Nano compute tier these can still take 10-30 min for wbg_pers because
-- the HNSW graph for 125k × 3072-dim doesn't fit in maintenance_work_mem.
-- We bump it locally before each build (capped at compute-tier limit).
-- =============================================================================

-- Bump maintenance_work_mem for this session (within available compute).
SET maintenance_work_mem = '512MB';

-- Small collections first (fast):
CREATE INDEX CONCURRENTLY IF NOT EXISTS pim_literature_embedding_hnsw_idx
  ON pim_literature USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS pima_reports_embedding_hnsw_idx
  ON pima_reports USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS pefa_reports_embedding_hnsw_idx
  ON pefa_reports USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- wbg_pers last (biggest — 125k rows). Reduced m and ef to lower memory.
CREATE INDEX CONCURRENTLY IF NOT EXISTS wbg_pers_embedding_hnsw_idx
  ON wbg_pers USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 8, ef_construction = 32);
