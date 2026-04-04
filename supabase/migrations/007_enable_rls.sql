-- Enable Row-Level Security on all tables.
-- Only the service_role (used by API routes) can access data.
-- Anonymous/authenticated users are blocked.

ALTER TABLE pim_literature ENABLE ROW LEVEL SECURITY;
CREATE POLICY pim_literature_service_role ON pim_literature
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE pima_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY pima_reports_service_role ON pima_reports
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE wbg_pers ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbg_pers_service_role ON wbg_pers
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE embedding_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY embedding_cache_service_role ON embedding_cache
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE response_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY response_cache_service_role ON response_cache
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE query_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY query_logs_service_role ON query_logs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
