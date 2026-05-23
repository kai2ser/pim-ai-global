-- =============================================================================
-- 013: Audit log for registry-refresh runs.
--
-- Every invocation of /api/cron/refresh-registry or /api/admin/refresh-registry
-- writes a row here. The /admin page reads from this to show recent runs +
-- diffs ("12 new PEFA assessments catalogued").
--
-- Service-role write only; anon-read disabled (admin UI uses the service
-- role via /api/admin/recent-refreshes).
-- =============================================================================

CREATE TABLE IF NOT EXISTS registry_refresh_log (
  id              BIGSERIAL PRIMARY KEY,
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  triggered_by    TEXT NOT NULL,            -- 'cron' | 'admin'
  collection_id   TEXT NOT NULL REFERENCES collections(id),
  scraper         TEXT NOT NULL,            -- 'pefa' | 'pima' | 'wbg'
  status          TEXT NOT NULL,            -- 'ok' | 'partial' | 'error' | 'stub'
  dry_run         BOOLEAN NOT NULL DEFAULT false,
  fetched_count   INT NOT NULL DEFAULT 0,   -- total rows the scraper produced
  new_count       INT NOT NULL DEFAULT 0,   -- of which were new (not in documents yet)
  duration_ms     INT NOT NULL DEFAULT 0,
  error_message   TEXT,
  metadata        JSONB DEFAULT '{}'::jsonb -- per-scraper notes (e.g. URLs visited)
);

CREATE INDEX IF NOT EXISTS idx_registry_refresh_log_triggered_at
  ON registry_refresh_log (triggered_at DESC);

-- RLS: service-role only. The admin UI reads via the admin-token-gated
-- /api/admin/recent-refreshes route which uses the service role.
ALTER TABLE registry_refresh_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname='registry_refresh_log_service_role'
  ) THEN
    EXECUTE 'CREATE POLICY registry_refresh_log_service_role ON registry_refresh_log
             FOR ALL USING (auth.role() = ''service_role'')
                 WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END $$;
