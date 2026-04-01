-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. Global PIM Good Practices  (_dataPIMLIt)
-- ============================================================
CREATE TABLE IF NOT EXISTS pim_literature (
  id            BIGSERIAL PRIMARY KEY,
  content       TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}'::jsonb,
  embedding     vector(1536),
  source_file   TEXT,
  page_number   INTEGER,
  chunk_index   INTEGER,
  chunk_type    TEXT DEFAULT 'text',  -- 'text' or 'image'
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pim_literature_embedding_idx
  ON pim_literature
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- 2. IMF PIMA Reports  (_dataPIMAs)
-- ============================================================
CREATE TABLE IF NOT EXISTS pima_reports (
  id            BIGSERIAL PRIMARY KEY,
  content       TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}'::jsonb,
  embedding     vector(1536),
  source_file   TEXT,
  page_number   INTEGER,
  chunk_index   INTEGER,
  chunk_type    TEXT DEFAULT 'text',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pima_reports_embedding_idx
  ON pima_reports
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- 3. World Bank Public Finance Reviews  (_dataWBGPERS)
-- ============================================================
CREATE TABLE IF NOT EXISTS wbg_pers (
  id            BIGSERIAL PRIMARY KEY,
  content       TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}'::jsonb,
  embedding     vector(1536),
  source_file   TEXT,
  page_number   INTEGER,
  chunk_index   INTEGER,
  chunk_type    TEXT DEFAULT 'text',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wbg_pers_embedding_idx
  ON wbg_pers
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- RPC: Similarity search function for each collection
-- ============================================================
CREATE OR REPLACE FUNCTION match_pim_literature(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  metadata JSONB,
  source_file TEXT,
  page_number INTEGER,
  chunk_type TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pl.id,
    pl.content,
    pl.metadata,
    pl.source_file,
    pl.page_number,
    pl.chunk_type,
    1 - (pl.embedding <=> query_embedding) AS similarity
  FROM pim_literature pl
  WHERE 1 - (pl.embedding <=> query_embedding) > match_threshold
  ORDER BY pl.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_pima_reports(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  metadata JSONB,
  source_file TEXT,
  page_number INTEGER,
  chunk_type TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.id,
    pr.content,
    pr.metadata,
    pr.source_file,
    pr.page_number,
    pr.chunk_type,
    1 - (pr.embedding <=> query_embedding) AS similarity
  FROM pima_reports pr
  WHERE 1 - (pr.embedding <=> query_embedding) > match_threshold
  ORDER BY pr.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_wbg_pers(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  metadata JSONB,
  source_file TEXT,
  page_number INTEGER,
  chunk_type TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wp.id,
    wp.content,
    wp.metadata,
    wp.source_file,
    wp.page_number,
    wp.chunk_type,
    1 - (wp.embedding <=> query_embedding) AS similarity
  FROM wbg_pers wp
  WHERE 1 - (wp.embedding <=> query_embedding) > match_threshold
  ORDER BY wp.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- RPC: Stats function for dashboard
-- ============================================================
CREATE OR REPLACE FUNCTION get_collection_stats()
RETURNS TABLE (
  collection_name TEXT,
  total_chunks BIGINT,
  text_chunks BIGINT,
  image_chunks BIGINT,
  unique_documents BIGINT,
  avg_content_length NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    'Global PIM Good Practices'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE pl.chunk_type = 'text')::BIGINT,
    COUNT(*) FILTER (WHERE pl.chunk_type = 'image')::BIGINT,
    COUNT(DISTINCT pl.source_file)::BIGINT,
    ROUND(AVG(LENGTH(pl.content))::NUMERIC, 0)
  FROM pim_literature pl
  UNION ALL
  SELECT
    'IMF PIMA Reports'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE pr.chunk_type = 'text')::BIGINT,
    COUNT(*) FILTER (WHERE pr.chunk_type = 'image')::BIGINT,
    COUNT(DISTINCT pr.source_file)::BIGINT,
    ROUND(AVG(LENGTH(pr.content))::NUMERIC, 0)
  FROM pima_reports pr
  UNION ALL
  SELECT
    'World Bank PFRs'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE wp.chunk_type = 'text')::BIGINT,
    COUNT(*) FILTER (WHERE wp.chunk_type = 'image')::BIGINT,
    COUNT(DISTINCT wp.source_file)::BIGINT,
    ROUND(AVG(LENGTH(wp.content))::NUMERIC, 0)
  FROM wbg_pers wp;
END;
$$;
