-- Embedding cache: avoids redundant OpenAI embedding calls for repeated queries
CREATE TABLE IF NOT EXISTS embedding_cache (
  id bigserial PRIMARY KEY,
  query_hash text UNIQUE NOT NULL,
  query_text text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz DEFAULT now(),
  hit_count int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache (query_hash);

-- Response cache: avoids redundant LLM calls for identical query+collection+model
CREATE TABLE IF NOT EXISTS response_cache (
  id bigserial PRIMARY KEY,
  cache_key text UNIQUE NOT NULL,
  query_text text NOT NULL,
  collection text NOT NULL,
  model text NOT NULL,
  answer text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]',
  provider text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz DEFAULT now(),
  hit_count int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_response_cache_key ON response_cache (cache_key);
CREATE INDEX IF NOT EXISTS idx_response_cache_created ON response_cache (created_at);

-- Query logs: structured observability for every query
CREATE TABLE IF NOT EXISTS query_logs (
  id bigserial PRIMARY KEY,
  query_text text NOT NULL,
  collection text NOT NULL,
  model text NOT NULL,
  provider text,
  ip_hash text,
  embedding_ms int,
  retrieval_ms int,
  llm_ms int,
  total_ms int,
  input_tokens int,
  output_tokens int,
  chunk_count int,
  cache_hit boolean DEFAULT false,
  error text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_query_logs_created ON query_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_query_logs_collection ON query_logs (collection);
