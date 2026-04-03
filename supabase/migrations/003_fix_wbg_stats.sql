-- Fix WBG stats timeout by removing expensive AVG(LENGTH(content))
-- on 161K+ rows. Use a sampled estimate instead.

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
    -- Sample-based avg: take avg of first 1000 rows (fast, ~accurate)
    (SELECT ROUND(AVG(LENGTH(content))::NUMERIC, 0)
     FROM (SELECT content FROM wbg_pers LIMIT 1000) s
    )
  FROM wbg_pers;
$$;
