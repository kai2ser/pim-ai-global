-- =============================================================================
-- 011: Typed cache-hit RPCs (replaces the unsafe `exec_sql` interpolation
--      pattern in src/lib/cache.ts).
--
-- The original code in cache.ts called a (never-defined) `exec_sql` RPC with
-- a raw interpolated SQL string:
--     UPDATE embedding_cache SET hit_count = hit_count + 1 WHERE query_hash = '${hash}'
--
-- The hash itself is server-derived hex, so today there's no live exploit,
-- but the pattern is a SQL-injection footgun for anyone who copies it. This
-- migration introduces two narrow, parameterized increment functions and the
-- application code in cache.ts switches over to them. The exec_sql RPC is
-- explicitly dropped if it exists.
-- =============================================================================

-- Defense-in-depth: ensure the dangerous `exec_sql` RPC is not present.
-- (We never created it in any migration, but external Supabase templates
-- sometimes do.)
DROP FUNCTION IF EXISTS exec_sql(text);
DROP FUNCTION IF EXISTS exec_sql(text, jsonb);
DROP FUNCTION IF EXISTS public.exec_sql(text);
DROP FUNCTION IF EXISTS public.exec_sql(text, jsonb);

-- Narrow, parameterized increment for the embedding cache.
CREATE OR REPLACE FUNCTION increment_embedding_cache_hit(p_hash TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE embedding_cache
  SET hit_count = hit_count + 1
  WHERE query_hash = p_hash;
$$;

REVOKE ALL ON FUNCTION increment_embedding_cache_hit(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_embedding_cache_hit(TEXT) TO service_role;

-- Narrow, parameterized increment for the response cache.
CREATE OR REPLACE FUNCTION increment_response_cache_hit(p_key TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE response_cache
  SET hit_count = hit_count + 1
  WHERE cache_key = p_key;
$$;

REVOKE ALL ON FUNCTION increment_response_cache_hit(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_response_cache_hit(TEXT) TO service_role;
