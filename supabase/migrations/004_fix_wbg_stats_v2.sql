-- Fix WBG stats: split into count-only (fast) + distinct via index scan
-- The COUNT(DISTINCT source_file) on 161K rows is expensive without
-- a dedicated approach. Use a subquery that leverages the index.

CREATE OR REPLACE FUNCTION stats_wbg_pers()
RETURNS TABLE (
  total_chunks BIGINT,
  text_chunks BIGINT,
  image_chunks BIGINT,
  unique_documents BIGINT,
  avg_content_length NUMERIC
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_total BIGINT;
  v_text BIGINT;
  v_image BIGINT;
  v_docs BIGINT;
  v_avg NUMERIC;
BEGIN
  -- Fast: uses table stats or sequential count
  SELECT COUNT(*) INTO v_total FROM wbg_pers;

  -- Fast with chunk_type index
  SELECT COUNT(*) INTO v_text FROM wbg_pers WHERE chunk_type = 'text';
  SELECT COUNT(*) INTO v_image FROM wbg_pers WHERE chunk_type = 'image';

  -- Use index on source_file for distinct count
  SELECT COUNT(*) INTO v_docs
  FROM (SELECT DISTINCT source_file FROM wbg_pers) sub;

  -- Sample-based average
  SELECT ROUND(AVG(LENGTH(content))::NUMERIC, 0) INTO v_avg
  FROM (SELECT content FROM wbg_pers LIMIT 500) s;

  RETURN QUERY SELECT v_total, v_text, v_image, v_docs, v_avg;
END;
$$;
