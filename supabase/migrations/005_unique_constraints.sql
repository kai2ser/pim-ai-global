-- Add unique constraints to prevent duplicate chunks from re-ingestion.
-- Each chunk is uniquely identified by its source file + chunk index.

CREATE UNIQUE INDEX IF NOT EXISTS pim_literature_unique_chunk
  ON pim_literature (source_file, chunk_index);

CREATE UNIQUE INDEX IF NOT EXISTS pima_reports_unique_chunk
  ON pima_reports (source_file, chunk_index);

CREATE UNIQUE INDEX IF NOT EXISTS wbg_pers_unique_chunk
  ON wbg_pers (source_file, chunk_index);
