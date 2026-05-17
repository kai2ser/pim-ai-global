/**
 * Re-embed every chunk in pim_literature / pima_reports / wbg_pers from the
 * stored content text using OpenAI text-embedding-3-large (3072-dim),
 * writing the result to the `embedding_v2 halfvec(3072)` staging column
 * added by migration 009.
 *
 * PEFA chunks are skipped — migration 009 already cast their existing
 * vector(3072) into embedding_v2 halfvec(3072) in place (lossless enough).
 *
 * The script is resumable: each batch is a single transaction with an
 * idempotent `WHERE embedding_v2 IS NULL` filter, so re-running after a
 * crash continues from where it left off.
 *
 * Usage:
 *   npm run migrate:reembed
 *   npm run migrate:reembed -- --table wbg_pers      # just one table
 *   npm run migrate:reembed -- --dry-run             # count only
 *   npm run migrate:reembed -- --batch 50            # smaller batches
 */
import dotenv from "dotenv";
import path from "path";
// dotenv must run before any module reads process.env. TypeScript hoists imports,
// so we keep our own local OpenAI client + Supabase client inline below rather
// than importing from src/lib (which would try to read env at module-load time).
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const TABLES = ["pim_literature", "pima_reports", "wbg_pers"] as const;
type Table = (typeof TABLES)[number];

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const flagValue = (name: string) => {
  const idx = argv.indexOf(`--${name}`);
  return idx === -1 ? undefined : argv[idx + 1];
};

const DRY_RUN = flag("dry-run");
const TABLE_FILTER = flagValue("table") as Table | undefined;
const BATCH_SIZE = parseInt(flagValue("batch") ?? "100", 10);
const SUPABASE_PAGE = 500; // rows fetched per Supabase paging call
const EMBED_MODEL = "text-embedding-3-large";

function getEnv(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env var: ${name}`);
  return v ?? "";
}

const supabase = createClient(
  getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

// Use the admin key for ingest if provided, otherwise fall back to the user key.
// Separating them lets the admin set a higher spending limit on the admin key
// without exposing the user-facing app to runaway costs.
const openai = new OpenAI({
  apiKey: getEnv("OPENAI_ADMIN_API_KEY", false) || getEnv("OPENAI_API_KEY"),
});

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function embedBatch(texts: string[], retries = 5): Promise<number[][]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: texts,
      });
      return r.data.map((d) => d.embedding);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (attempt === retries) throw e;
      const delay =
        err.status === 429 ? 60_000 : Math.pow(2, attempt) * 1_000;
      console.warn(
        `  Embed attempt ${attempt} failed (${err.status ?? "?"}); retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
  throw new Error("unreachable");
}

async function tableTotals(table: Table) {
  const { count: total } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  const { count: done } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .not("embedding_v2", "is", null);
  return { total: total ?? 0, done: done ?? 0 };
}

async function reembedTable(table: Table) {
  const { total, done } = await tableTotals(table);
  const remaining = total - done;
  console.log(
    `\n=== ${table}: ${total.toLocaleString()} chunks, ${done.toLocaleString()} already done, ${remaining.toLocaleString()} remaining ===`
  );
  if (DRY_RUN) return { processed: 0, errors: 0, remaining };
  if (remaining === 0) return { processed: 0, errors: 0, remaining: 0 };

  let processed = 0;
  let errors = 0;
  const t0 = Date.now();

  while (true) {
    // Page through rows where embedding_v2 IS NULL. We always fetch from the
    // beginning of the not-yet-processed set, so as we UPDATE rows they drop
    // out of the result, ensuring forward progress.
    const { data: rows, error } = await supabase
      .from(table)
      .select("id, content")
      .is("embedding_v2", null)
      .order("id", { ascending: true })
      .limit(SUPABASE_PAGE);

    if (error) throw new Error(`Fetch failed: ${error.message}`);
    if (!rows || rows.length === 0) break;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const texts = batch.map((r) =>
        (r.content as string).replace(/\n/g, " ").trim().slice(0, 8192) || " "
      );

      let vecs: number[][];
      try {
        vecs = await embedBatch(texts);
      } catch (e) {
        console.error(
          `  Batch failed irrecoverably: ${(e as Error).message}`
        );
        errors += batch.length;
        continue;
      }

      // UPDATE rows one-by-one — pgvector / halfvec doesn't have a clean
      // bulk-update path through PostgREST. Each call is small (single row,
      // single vector) and runs in parallel below.
      const updates = batch.map((row, j) =>
        supabase
          .from(table)
          .update({ embedding_v2: vecs[j] })
          .eq("id", row.id)
      );
      const results = await Promise.all(updates);
      for (const res of results) {
        if (res.error) {
          console.error(`  UPDATE failed: ${res.error.message}`);
          errors++;
        }
      }
      processed += batch.length;

      // Tight progress line
      const elapsed = (Date.now() - t0) / 1000;
      const rate = processed / elapsed;
      const eta = remaining > processed ? (remaining - processed) / rate : 0;
      process.stdout.write(
        `\r  ${table}: ${processed.toLocaleString()}/${remaining.toLocaleString()} (${rate.toFixed(0)}/s, ETA ${Math.ceil(eta)}s)  errors=${errors}    `
      );
    }
  }

  console.log("");
  return { processed, errors, remaining };
}

async function checkPefaCastCoverage() {
  // Migration 009 casts pefa_chunks.embedding (vector(3072)) into the new
  // embedding_v2 (halfvec(3072)) column in place. Re-running that migration
  // top-ups any rows inserted between 009 and the swap migration 010. This
  // function only verifies the cast is complete; the cast itself happens
  // in 009 because plain UPDATE statements there are simpler than dispatching
  // them from Node.
  const { count } = await supabase
    .from("pefa_chunks")
    .select("*", { count: "exact", head: true })
    .is("embedding_v2", null)
    .not("embedding", "is", null);
  if (!count) {
    console.log("=== pefa_chunks: already cast to halfvec(3072) ===");
    return;
  }
  console.warn(
    `=== pefa_chunks: ${count} rows still have embedding but no embedding_v2.\n` +
      "    Re-run migration 009 (its UPDATE block is idempotent) before proceeding to 010."
  );
}

async function main() {
  console.log(`Re-embed to ${EMBED_MODEL} (3072-dim halfvec)`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "WRITE"}`);
  if (TABLE_FILTER) console.log(`Table filter: ${TABLE_FILTER}`);
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  let totalProcessed = 0;
  let totalErrors = 0;
  let totalRemaining = 0;

  for (const t of TABLES) {
    if (TABLE_FILTER && t !== TABLE_FILTER) continue;
    const { processed, errors, remaining } = await reembedTable(t);
    totalProcessed += processed;
    totalErrors += errors;
    totalRemaining += remaining;
  }

  if (!TABLE_FILTER) await checkPefaCastCoverage();

  console.log("\n=== Done ===");
  console.log(`Processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Errors:    ${totalErrors}`);
  console.log(`Remaining: ${totalRemaining.toLocaleString()}`);
  if (totalErrors > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
