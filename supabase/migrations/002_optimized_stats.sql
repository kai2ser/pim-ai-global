-- ============================================================
-- Optimized per-table stats functions
-- Each runs a SINGLE query with conditional aggregation
-- Requires index on source_file (already created)
-- ============================================================

CREATE OR REPLACE FUNCTION stats_pim_literature()
RETURNS TABLE (
  total_chunks BIGINT,
  text_chunks BIGINT,
  image_chunks BIGINT,
  unique_documents BIGINT,
  avg_content_length NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'text')::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'image')::BIGINT,
    COUNT(DISTINCT source_file)::BIGINT,
    ROUND(AVG(LENGTH(content))::NUMERIC, 0)
  FROM pim_literature;
$$;

CREATE OR REPLACE FUNCTION stats_pima_reports()
RETURNS TABLE (
  total_chunks BIGINT,
  text_chunks BIGINT,
  image_chunks BIGINT,
  unique_documents BIGINT,
  avg_content_length NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'text')::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'image')::BIGINT,
    COUNT(DISTINCT source_file)::BIGINT,
    ROUND(AVG(LENGTH(content))::NUMERIC, 0)
  FROM pima_reports;
$$;

CREATE OR REPLACE FUNCTION stats_wbg_pers()
RETURNS TABLE (
  total_chunks BIGINT,
  text_chunks BIGINT,
  image_chunks BIGINT,
  unique_documents BIGINT,
  avg_content_length NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'text')::BIGINT,
    COUNT(*) FILTER (WHERE chunk_type = 'image')::BIGINT,
    COUNT(DISTINCT source_file)::BIGINT,
    ROUND(AVG(LENGTH(content))::NUMERIC, 0)
  FROM wbg_pers;
$$;

-- Add indexes to speed up the stats queries
CREATE INDEX IF NOT EXISTS pim_literature_chunk_type_idx ON pim_literature (chunk_type);
CREATE INDEX IF NOT EXISTS pima_reports_chunk_type_idx ON pima_reports (chunk_type);
CREATE INDEX IF NOT EXISTS wbg_pers_chunk_type_idx ON wbg_pers (chunk_type);

CREATE INDEX IF NOT EXISTS pim_literature_source_file_idx ON pim_literature (source_file);
CREATE INDEX IF NOT EXISTS pima_reports_source_file_idx ON pima_reports (source_file);
CREATE INDEX IF NOT EXISTS wbg_pers_source_file_idx ON wbg_pers (source_file);
