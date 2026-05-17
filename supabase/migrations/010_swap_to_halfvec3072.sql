-- =============================================================================
-- 010: Atomic swap from vector(1536) → halfvec(3072) + PEFA rename + new RPCs.
--
-- APPLY ONLY AFTER `scripts/migrate/reembed-to-3072.ts` has populated
-- embedding_v2 for every row in pim_literature, pima_reports, wbg_pers,
-- pefa_chunks. Verify with:
--
--   SELECT 'pim_literature', COUNT(*) FILTER (WHERE embedding_v2 IS NULL) FROM pim_literature
--   UNION ALL
--   SELECT 'pima_reports',   COUNT(*) FILTER (WHERE embedding_v2 IS NULL) FROM pima_reports
--   UNION ALL
--   SELECT 'wbg_pers',       COUNT(*) FILTER (WHERE embedding_v2 IS NULL) FROM wbg_pers
--   UNION ALL
--   SELECT 'pefa_chunks',    COUNT(*) FILTER (WHERE embedding_v2 IS NULL) FROM pefa_chunks;
--
-- All counts must be 0 before running this migration. The whole thing runs in
-- a single transaction so the live app sees the schema change atomically.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. pim_literature: drop old embedding, swap in halfvec(3072) + HNSW
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS pim_literature_embedding_idx;
ALTER TABLE pim_literature DROP COLUMN embedding;
ALTER TABLE pim_literature RENAME COLUMN embedding_v2 TO embedding;
CREATE INDEX pim_literature_embedding_hnsw_idx
  ON pim_literature USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- -----------------------------------------------------------------------------
-- 2. pima_reports
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS pima_reports_embedding_idx;
ALTER TABLE pima_reports DROP COLUMN embedding;
ALTER TABLE pima_reports RENAME COLUMN embedding_v2 TO embedding;
CREATE INDEX pima_reports_embedding_hnsw_idx
  ON pima_reports USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- -----------------------------------------------------------------------------
-- 3. wbg_pers
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS wbg_pers_embedding_idx;
ALTER TABLE wbg_pers DROP COLUMN embedding;
ALTER TABLE wbg_pers RENAME COLUMN embedding_v2 TO embedding;
CREATE INDEX wbg_pers_embedding_hnsw_idx
  ON wbg_pers USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- -----------------------------------------------------------------------------
-- 4. pefa_chunks → pefa_reports (table rename + swap)
-- -----------------------------------------------------------------------------
ALTER TABLE pefa_chunks DROP COLUMN embedding;
ALTER TABLE pefa_chunks RENAME COLUMN embedding_v2 TO embedding;
ALTER TABLE pefa_chunks RENAME TO pefa_reports;
CREATE INDEX pefa_reports_embedding_hnsw_idx
  ON pefa_reports USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Rename the PEFA collection id and update child rows.
-- collection_id is TEXT FK so we have to UPDATE child rows first.
INSERT INTO collections (id, display_name, description)
  SELECT 'pefa_reports', display_name, description FROM collections WHERE id = 'pefa'
ON CONFLICT (id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      description  = EXCLUDED.description;

UPDATE documents              SET collection_id = 'pefa_reports' WHERE collection_id = 'pefa';
UPDATE collection_tag_classes SET collection_id = 'pefa_reports' WHERE collection_id = 'pefa';
DELETE FROM collections WHERE id = 'pefa';

-- -----------------------------------------------------------------------------
-- 5. Drop old RPCs and create halfvec(3072) versions with document_ids filter.
--    All 4 RPCs follow the same shape now. Function signature change requires
--    DROP + CREATE because PG can't change parameter types in place.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS match_pim_literature(vector, float, int);
DROP FUNCTION IF EXISTS match_pima_reports(vector, float, int);
DROP FUNCTION IF EXISTS match_wbg_pers(vector, float, int);
DROP FUNCTION IF EXISTS match_pefa_chunks(vector, float, int);

CREATE OR REPLACE FUNCTION match_pim_literature(
  query_embedding halfvec(3072),
  match_threshold FLOAT  DEFAULT 0.5,
  match_count     INT    DEFAULT 10,
  document_ids    UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id           BIGINT,
  document_id  UUID,
  content      TEXT,
  metadata     JSONB,
  source_file  TEXT,
  page_number  INTEGER,
  chunk_type   TEXT,
  similarity   FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.document_id, c.content, c.metadata, c.source_file, c.page_number, c.chunk_type,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM pim_literature c
  WHERE (document_ids IS NULL OR c.document_id = ANY(document_ids))
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_pima_reports(
  query_embedding halfvec(3072),
  match_threshold FLOAT  DEFAULT 0.5,
  match_count     INT    DEFAULT 10,
  document_ids    UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT, document_id UUID, content TEXT, metadata JSONB,
  source_file TEXT, page_number INTEGER, chunk_type TEXT, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.document_id, c.content, c.metadata, c.source_file, c.page_number, c.chunk_type,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM pima_reports c
  WHERE (document_ids IS NULL OR c.document_id = ANY(document_ids))
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_wbg_pers(
  query_embedding halfvec(3072),
  match_threshold FLOAT  DEFAULT 0.5,
  match_count     INT    DEFAULT 10,
  document_ids    UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT, document_id UUID, content TEXT, metadata JSONB,
  source_file TEXT, page_number INTEGER, chunk_type TEXT, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.document_id, c.content, c.metadata, c.source_file, c.page_number, c.chunk_type,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM wbg_pers c
  WHERE (document_ids IS NULL OR c.document_id = ANY(document_ids))
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- match_pefa_reports returns the same shape as the upstream match RPCs by
-- joining documents to synthesize source_file from the document filename and
-- emitting a constant chunk_type='text' (PEFA chunks are all text for now).
-- id is cast to text so consumers can key uniformly across collections.
CREATE OR REPLACE FUNCTION match_pefa_reports(
  query_embedding halfvec(3072),
  match_threshold FLOAT  DEFAULT 0.5,
  match_count     INT    DEFAULT 10,
  document_ids    UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id          TEXT,
  document_id UUID,
  content     TEXT,
  metadata    JSONB,
  source_file TEXT,
  page_number INTEGER,
  chunk_type  TEXT,
  similarity  FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id::TEXT,
    c.document_id,
    c.content,
    COALESCE(c.metadata, '{}'::jsonb) AS metadata,
    d.filename AS source_file,
    c.page_number,
    'text'::TEXT AS chunk_type,
    (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
  FROM pefa_reports c
  LEFT JOIN documents d ON c.document_id = d.id
  WHERE (document_ids IS NULL OR c.document_id = ANY(document_ids))
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- stats_pefa_reports — matches the per-collection stats pattern used by /api/stats
CREATE OR REPLACE FUNCTION stats_pefa_reports()
RETURNS TABLE (
  total_chunks BIGINT,
  text_chunks BIGINT,
  image_chunks BIGINT,
  unique_documents BIGINT,
  avg_content_length NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*)::BIGINT,
    0::BIGINT,
    COUNT(DISTINCT document_id)::BIGINT,
    ROUND(AVG(LENGTH(content))::NUMERIC, 0)
  FROM pefa_reports;
$$;

-- -----------------------------------------------------------------------------
-- 6. embedding_cache + response_cache: old cached entries are now invalid.
-- -----------------------------------------------------------------------------
TRUNCATE embedding_cache;
ALTER TABLE embedding_cache DROP COLUMN embedding;
ALTER TABLE embedding_cache ADD COLUMN embedding halfvec(3072) NOT NULL;

TRUNCATE response_cache;

-- -----------------------------------------------------------------------------
-- 7. Update get_collection_stats() to include PEFA.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_collection_stats();
CREATE OR REPLACE FUNCTION get_collection_stats()
RETURNS TABLE (
  collection_id      TEXT,
  collection_name    TEXT,
  total_chunks       BIGINT,
  text_chunks        BIGINT,
  image_chunks       BIGINT,
  unique_documents   BIGINT,
  avg_content_length NUMERIC
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    'pim_literature'::TEXT,
    'Global PIM Good Practices'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'text')::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'image')::BIGINT,
    COUNT(DISTINCT source_file)::BIGINT,
    ROUND(AVG(LENGTH(content))::NUMERIC, 0)
  FROM pim_literature
  UNION ALL
  SELECT
    'pima_reports'::TEXT,
    'IMF PIMA Reports'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'text')::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'image')::BIGINT,
    COUNT(DISTINCT source_file)::BIGINT,
    ROUND(AVG(LENGTH(content))::NUMERIC, 0)
  FROM pima_reports
  UNION ALL
  SELECT
    'wbg_pers'::TEXT,
    'World Bank PFRs'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'text')::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'image')::BIGINT,
    COUNT(DISTINCT source_file)::BIGINT,
    ROUND(AVG(LENGTH(content))::NUMERIC, 0)
  FROM wbg_pers
  UNION ALL
  SELECT
    'pefa_reports'::TEXT,
    'PEFA National Reports'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*)::BIGINT,
    0::BIGINT,
    COUNT(DISTINCT document_id)::BIGINT,
    ROUND(AVG(LENGTH(content))::NUMERIC, 0)
  FROM pefa_reports;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Registry VIEWs for the upcoming /registry UI.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW documents_ranked_per_country_type AS
SELECT
  d.*,
  ROW_NUMBER() OVER (
    PARTITION BY d.collection_id, d.country, COALESCE(d.tags->>'category', 'default')
    ORDER BY d.year DESC NULLS LAST, d.ingested_at DESC NULLS LAST
  ) AS rn_per_type
FROM documents d;

CREATE OR REPLACE VIEW documents_latest_per_type AS
SELECT * FROM documents_ranked_per_country_type WHERE rn_per_type = 1;

CREATE OR REPLACE VIEW country_registry_summary AS
SELECT
  collection_id,
  country,
  COUNT(*)                                                            AS total_reports,
  COUNT(*) FILTER (WHERE tags->>'category' = 'national')              AS national_count,
  COUNT(*) FILTER (WHERE tags->>'category' = 'subnational')           AS subnational_count,
  COUNT(*) FILTER (WHERE tags->>'category' = 'climate')               AS climate_count,
  COUNT(*) FILTER (WHERE tags->>'category' = 'gender')                AS gender_count,
  MAX(year)                                                           AS latest_year,
  COUNT(*) FILTER (WHERE ingestion_status = 'embedded')               AS embedded_count
FROM documents
WHERE country IS NOT NULL
GROUP BY collection_id, country;

COMMIT;
