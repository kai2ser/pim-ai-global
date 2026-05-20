-- =============================================================================
-- 012: Restrict the documents anon-read policy.
--
-- Migration 009 opened `documents` to anonymous SELECT with USING (true), so
-- the future /registry UI could render without the service role. But that
-- policy also exposes rows we explicitly catalogued as not-for-publication —
-- PEFA non-public assessments live in documents with
-- `ingestion_status = 'excluded'` and metadata containing the (potentially
-- sensitive) source URL.
--
-- This migration tightens the policy to hide excluded and failed rows from
-- anonymous reads. The service_role policy is unchanged — server-side admin
-- routes still see everything.
-- =============================================================================

DROP POLICY IF EXISTS documents_anon_read ON documents;

CREATE POLICY documents_anon_read ON documents
  FOR SELECT
  USING (
    ingestion_status IS NULL                       -- never blocks legacy rows
    OR ingestion_status NOT IN ('excluded', 'failed')
  );
