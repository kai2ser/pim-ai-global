-- =============================================================================
-- 009: Unify chunk tables under a shared `documents` registry + merge PEFA.
--
-- This migration is NON-DISRUPTIVE — the live app keeps querying the existing
-- vector(1536) `embedding` columns until migration 010 performs the atomic
-- swap to the new halfvec(3072) embeddings populated by the re-embed script.
--
-- Phases:
--   A. Register the 3 upstream collections in `collections` (pefa already there
--      from migration 001_pefa.sql).
--   B. Backfill `documents` registry rows from existing chunks' `source_file`.
--   C. Add `document_id UUID` FK to each upstream chunk table + populate it.
--   D. Add staging `embedding_v2 halfvec(3072)` column to every chunk table.
--   E. Cast pefa_chunks' existing vector(3072) → halfvec(3072) in place
--      (no re-embedding cost; halfvec accepts vector input).
--   F. Add registry columns to documents (ingestion_status, tags, source_url,
--      source_last_seen).
--   G. Create `collection_tag_classes` registry + seed initial classes.
--   H. RLS for the new infrastructure tables, plus anon-read on registry tables
--      so the upcoming /registry UI doesn't need the service role key.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- A. Register upstream collections in the registry.
--    (collections table was created by migration 001_pefa.sql.)
-- -----------------------------------------------------------------------------
INSERT INTO collections (id, display_name, description) VALUES
  ('pim_literature', 'Global PIM Good Practices',
   'Literature and reference documents on public investment management from IMF, World Bank, EC, EIB, and JICA.'),
  ('pima_reports',   'IMF PIMA Reports',
   'Public Investment Management Assessment reports by the International Monetary Fund.'),
  ('wbg_pers',       'World Bank Public Finance Reviews',
   'Public Expenditure Reviews and Public Finance Reviews from the World Bank Group.')
ON CONFLICT (id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      description  = EXCLUDED.description;

-- -----------------------------------------------------------------------------
-- B. Backfill `documents` from each upstream chunk table's distinct source_file.
-- -----------------------------------------------------------------------------
INSERT INTO documents (collection_id, filename, filepath, file_type, chunk_count, metadata)
SELECT
  'pim_literature',
  source_file,
  source_file,
  COALESCE(LOWER(regexp_replace(source_file, '.*\.', '')), 'pdf'),
  COUNT(*),
  '{}'::jsonb
FROM pim_literature
WHERE source_file IS NOT NULL
GROUP BY source_file
ON CONFLICT (collection_id, filepath) DO NOTHING;

INSERT INTO documents (collection_id, filename, filepath, file_type, chunk_count, metadata)
SELECT
  'pima_reports', source_file, source_file,
  COALESCE(LOWER(regexp_replace(source_file, '.*\.', '')), 'pdf'),
  COUNT(*), '{}'::jsonb
FROM pima_reports WHERE source_file IS NOT NULL
GROUP BY source_file
ON CONFLICT (collection_id, filepath) DO NOTHING;

INSERT INTO documents (collection_id, filename, filepath, file_type, chunk_count, metadata)
SELECT
  'wbg_pers', source_file, source_file,
  COALESCE(LOWER(regexp_replace(source_file, '.*\.', '')), 'pdf'),
  COUNT(*), '{}'::jsonb
FROM wbg_pers WHERE source_file IS NOT NULL
GROUP BY source_file
ON CONFLICT (collection_id, filepath) DO NOTHING;

-- -----------------------------------------------------------------------------
-- C. Add document_id FK to each upstream chunk table + populate.
--    PEFA's table already has document_id (from migration 001_pefa.sql).
-- -----------------------------------------------------------------------------
ALTER TABLE pim_literature ADD COLUMN IF NOT EXISTS document_id UUID;
UPDATE pim_literature c
SET document_id = d.id
FROM documents d
WHERE d.collection_id = 'pim_literature'
  AND d.filepath = c.source_file
  AND c.document_id IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pim_literature_document_fk'
  ) THEN
    ALTER TABLE pim_literature
      ADD CONSTRAINT pim_literature_document_fk
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pim_literature_document_id ON pim_literature(document_id);

ALTER TABLE pima_reports ADD COLUMN IF NOT EXISTS document_id UUID;
UPDATE pima_reports c
SET document_id = d.id
FROM documents d
WHERE d.collection_id = 'pima_reports'
  AND d.filepath = c.source_file
  AND c.document_id IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pima_reports_document_fk'
  ) THEN
    ALTER TABLE pima_reports
      ADD CONSTRAINT pima_reports_document_fk
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pima_reports_document_id ON pima_reports(document_id);

ALTER TABLE wbg_pers ADD COLUMN IF NOT EXISTS document_id UUID;
UPDATE wbg_pers c
SET document_id = d.id
FROM documents d
WHERE d.collection_id = 'wbg_pers'
  AND d.filepath = c.source_file
  AND c.document_id IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'wbg_pers_document_fk'
  ) THEN
    ALTER TABLE wbg_pers
      ADD CONSTRAINT wbg_pers_document_fk
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_wbg_pers_document_id ON wbg_pers(document_id);

-- -----------------------------------------------------------------------------
-- D. Staging column for new 3072-dim embeddings.
--    Populated in the background by scripts/migrate/reembed-to-3072.ts and
--    swapped in by migration 010.
-- -----------------------------------------------------------------------------
ALTER TABLE pim_literature ADD COLUMN IF NOT EXISTS embedding_v2 halfvec(3072);
ALTER TABLE pima_reports   ADD COLUMN IF NOT EXISTS embedding_v2 halfvec(3072);
ALTER TABLE wbg_pers       ADD COLUMN IF NOT EXISTS embedding_v2 halfvec(3072);
ALTER TABLE pefa_chunks    ADD COLUMN IF NOT EXISTS embedding_v2 halfvec(3072);

-- -----------------------------------------------------------------------------
-- E. PEFA already at vector(3072) — cast to halfvec(3072) for the new column.
--    No re-embedding cost; halfvec accepts vector input losslessly enough
--    (fp32 → fp16 quantization, retrieval-quality difference is negligible).
-- -----------------------------------------------------------------------------
UPDATE pefa_chunks
SET embedding_v2 = embedding::halfvec(3072)
WHERE embedding_v2 IS NULL AND embedding IS NOT NULL;

-- -----------------------------------------------------------------------------
-- F. Registry columns on documents.
-- -----------------------------------------------------------------------------
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS ingestion_status TEXT DEFAULT 'catalogued'
    CHECK (ingestion_status IN ('catalogued','downloaded','embedded','failed','excluded')),
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_last_seen TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(collection_id, ingestion_status);
CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents USING GIN (tags);

-- Backfill ingestion_status: anything with chunks → 'embedded'.
UPDATE documents
SET ingestion_status = 'embedded'
WHERE chunk_count > 0 AND ingestion_status = 'catalogued';

-- Backfill chunk_count for upstream collections (the inserts above already did
-- this, but ensure consistency if the chunk count drifts).
UPDATE documents d
SET chunk_count = c.cnt
FROM (
  SELECT collection_id, source_file, COUNT(*) AS cnt FROM (
    SELECT 'pim_literature' AS collection_id, source_file FROM pim_literature
    UNION ALL
    SELECT 'pima_reports',   source_file FROM pima_reports
    UNION ALL
    SELECT 'wbg_pers',       source_file FROM wbg_pers
  ) all_chunks
  WHERE source_file IS NOT NULL
  GROUP BY collection_id, source_file
) c
WHERE d.collection_id = c.collection_id
  AND d.filepath = c.source_file;

-- PEFA backfill: existing rows have metadata.is_public; promote to tags.
UPDATE documents
SET tags = jsonb_build_object(
  'category',     'national',
  'availability', COALESCE(metadata->>'availability', 'Public'),
  'is_public',    COALESCE((metadata->>'is_public')::boolean, true)
)
WHERE collection_id = 'pefa' AND (tags IS NULL OR tags = '{}'::jsonb);

UPDATE documents
SET ingestion_status = 'excluded'
WHERE collection_id = 'pefa'
  AND COALESCE((metadata->>'is_public')::boolean, true) = false;

-- -----------------------------------------------------------------------------
-- G. Collection tag classes — drives the per-collection filter chips in
--    the upcoming /registry UI. Use 'pefa' here; we rename to 'pefa_reports'
--    atomically in migration 010 alongside the table rename.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_tag_classes (
  collection_id   TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  tag_key         TEXT NOT NULL,
  display_label   TEXT NOT NULL,
  allowed_values  TEXT[] NOT NULL,
  ordering        INT DEFAULT 0,
  PRIMARY KEY (collection_id, tag_key)
);

INSERT INTO collection_tag_classes (collection_id, tag_key, display_label, allowed_values, ordering) VALUES
  ('pefa',           'category',     'Assessment type', ARRAY['national','subnational','climate','gender'],     1),
  ('pefa',           'availability', 'Availability',    ARRAY['Public','Non-public'],                            2),
  ('pima_reports',   'category',     'PIMA type',       ARRAY['standard','climate','gender'],                    1),
  ('wbg_pers',       'category',     'Report type',     ARRAY['per','pfr','sector'],                             1),
  ('pim_literature', 'doc_type',     'Document type',   ARRAY['framework','case-study','toolkit','guidance'],    1),
  ('pim_literature', 'publisher',    'Publisher',       ARRAY['imf','wb','ec','eib','jica'],                     2)
ON CONFLICT (collection_id, tag_key) DO UPDATE
  SET display_label  = EXCLUDED.display_label,
      allowed_values = EXCLUDED.allowed_values,
      ordering       = EXCLUDED.ordering;

-- -----------------------------------------------------------------------------
-- H. RLS. Registry tables get service-role write + anon read so the upcoming
--    /registry page can render without service role.
-- -----------------------------------------------------------------------------
ALTER TABLE collection_tag_classes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='collection_tag_classes_service_role') THEN
    EXECUTE 'CREATE POLICY collection_tag_classes_service_role ON collection_tag_classes
             FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='collection_tag_classes_anon_read') THEN
    EXECUTE 'CREATE POLICY collection_tag_classes_anon_read ON collection_tag_classes
             FOR SELECT USING (true)';
  END IF;
END $$;

ALTER TABLE documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='documents_service_role') THEN
    EXECUTE 'CREATE POLICY documents_service_role ON documents
             FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='documents_anon_read') THEN
    EXECUTE 'CREATE POLICY documents_anon_read ON documents FOR SELECT USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='collections_service_role') THEN
    EXECUTE 'CREATE POLICY collections_service_role ON collections
             FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='collections_anon_read') THEN
    EXECUTE 'CREATE POLICY collections_anon_read ON collections FOR SELECT USING (true)';
  END IF;
END $$;
