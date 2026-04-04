-- Function to clean up expired cache entries.
-- Call periodically: SELECT cleanup_caches();

CREATE OR REPLACE FUNCTION cleanup_caches()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_embeddings int;
  deleted_responses int;
  deleted_logs int;
BEGIN
  -- Remove embedding cache entries older than 30 days
  DELETE FROM embedding_cache WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted_embeddings = ROW_COUNT;

  -- Remove response cache entries older than 24 hours
  DELETE FROM response_cache WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS deleted_responses = ROW_COUNT;

  -- Remove query logs older than 90 days
  DELETE FROM query_logs WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS deleted_logs = ROW_COUNT;

  RETURN json_build_object(
    'deleted_embeddings', deleted_embeddings,
    'deleted_responses', deleted_responses,
    'deleted_logs', deleted_logs
  );
END;
$$;
