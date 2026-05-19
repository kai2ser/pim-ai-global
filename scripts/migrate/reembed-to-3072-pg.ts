/**
 * Re-embed every chunk in pim_literature / pima_reports / wbg_pers using
 * OpenAI text-embedding-3-large (3072-dim), writing the result to
 * `embedding_v2 halfvec(3072)`.
 *
 * Uses a single direct Postgres connection via `pg` and a single multi-row
 * UPDATE per batch. The previous PostgREST-based version (reembed-to-3072.ts)
 * was firing 100 concurrent UPDATE requests at the Supabase edge per batch,
 * which saturated the connection pool and produced ~25% error rate on the
 * wbg_pers table.
 *
 * Per batch this script:
 *   1. SELECTs N rows where embedding_v2 IS NULL  (1 query)
 *   2. Sends content to OpenAI for embeddings    (1 HTTP call)
 *   3. UPDATEs all N rows in one SQL statement   (1 query)
 *
 * Idempotent + resumable: each batch's UPDATE is `WHERE embedding_v2 IS NULL`,
 * so re-running picks up where it stopped.
 *
 * Usage:
 *   npm run migrate:reembed:pg
 *   npm run migrate:reembed:pg -- --table wbg_pers
 *   npm run migrate:reembed:pg -- --batch 50
 *   npm run migrate:reembed:pg -- --dry-run
 */
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Pool, type PoolClient } from "pg";
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
const EMBED_MODEL = "text-embedding-3-large";

function getEnv(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env var: ${name}`);
  return v ?? "";
}

const PG_URL = process.env.SUPABASE_DB_URL ?? "";
if (!PG_URL) {
  throw new Error(
    "Missing SUPABASE_DB_URL — set it to the Session-mode pooler URL " +
      "(postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require)"
  );
}

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
      const delay = err.status === 429 ? 60_000 : Math.pow(2, attempt) * 1_000;
      console.warn(
        `  OpenAI attempt ${attempt} failed (${err.status ?? "?"}: ${err.message}); retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
  throw new Error("unreachable");
}

function fmtVec(v: number[]): string {
  // pgvector / halfvec accepts the same literal format: '[0.1,0.2,...]'
  return "[" + v.join(",") + "]";
}

async function reembedTable(pool: Pool, table: Table) {
  // Helper: run a query with retry on connection drops.
  async function q<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    maxRetries = 4
  ): Promise<{ rows: T[] }> {
    let attempt = 0;
    while (true) {
      try {
        const r = await pool.query<T>(sql, params as never);
        return { rows: r.rows };
      } catch (e) {
        attempt++;
        const msg = (e as Error).message;
        if (attempt >= maxRetries) throw e;
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(
          `  query attempt ${attempt} failed (${msg}); retrying in ${delay}ms`
        );
        await sleep(delay);
      }
    }
  }

  // Quick counts
  const {
    rows: [{ total, done }],
  } = await q<{ total: string; done: string }>(
    `SELECT COUNT(*)::text AS total, COUNT(embedding_v2)::text AS done FROM ${table}`
  );
  const totalN = Number(total);
  const doneN = Number(done);
  const remaining = totalN - doneN;

  console.log(
    `\n=== ${table}: ${totalN.toLocaleString()} chunks, ${doneN.toLocaleString()} already done, ${remaining.toLocaleString()} remaining ===`
  );
  if (DRY_RUN || remaining === 0) return { processed: 0, errors: 0 };

  let processed = 0;
  let errors = 0;
  const t0 = Date.now();
  let nextProgressLog = 0;

  while (true) {
    // Pull next batch of unembedded rows.
    const { rows } = await q<{ id: number | string; content: string }>(
      `SELECT id, content FROM ${table}
       WHERE embedding_v2 IS NULL
       ORDER BY id
       LIMIT $1`,
      [BATCH_SIZE]
    );
    if (rows.length === 0) break;

    const texts = rows.map((r) =>
      (r.content || "").replace(/\n/g, " ").trim().slice(0, 8192) || " "
    );

    let vecs: number[][];
    try {
      vecs = await embedBatch(texts);
    } catch (e) {
      console.error(`  embed batch failed irrecoverably: ${(e as Error).message}`);
      errors += rows.length;
      // Skip these rows by marking them with an empty placeholder so the loop
      // makes forward progress. (We'd rather move on than infinite-loop.)
      // But to keep idempotency clean, just break — operator can re-run.
      break;
    }

    // Build a single multi-row UPDATE using FROM (VALUES (...), ...).
    // Casting via halfvec(::halfvec(3072)) and id via the column's type.
    // pg parameters: 2 per row (id, embedding text literal).
    const params: (number | string)[] = [];
    const placeholders: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const idParamIdx = i * 2 + 1;
      const embParamIdx = i * 2 + 2;
      params.push(rows[i].id as number, fmtVec(vecs[i]));
      placeholders.push(
        `($${idParamIdx}::bigint, $${embParamIdx}::halfvec(3072))`
      );
    }

    const sql = `UPDATE ${table} AS t
      SET embedding_v2 = v.emb
      FROM (VALUES ${placeholders.join(",")}) AS v(id, emb)
      WHERE t.id = v.id`;

    try {
      await q(sql, params);
    } catch (e) {
      console.error(
        `  UPDATE failed after retries: ${(e as Error).message}`
      );
      errors += rows.length;
    }

    processed += rows.length;
    if (processed >= nextProgressLog) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = processed / elapsed;
      const eta = remaining > processed ? (remaining - processed) / rate : 0;
      console.log(
        `  ${table}: ${processed.toLocaleString()}/${remaining.toLocaleString()} (${rate.toFixed(0)}/s, ETA ${Math.ceil(eta)}s)  errors=${errors}`
      );
      nextProgressLog = processed + 1000;
    }
  }

  console.log(
    `  ${table} done: processed ${processed.toLocaleString()}, errors ${errors}, elapsed ${Math.round(
      (Date.now() - t0) / 1000
    )}s`
  );
  return { processed, errors };
}

async function main() {
  console.log(`Re-embed to ${EMBED_MODEL} (3072-dim halfvec) via direct postgres`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "WRITE"}`);
  if (TABLE_FILTER) console.log(`Table filter: ${TABLE_FILTER}`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  // Use a Pool (auto-reconnects on dropped connections). Single connection is
  // enough — our work is sequential. SSL: ignore cert chain (Supabase pooler's
  // internal CA isn't in Node's default trust store).
  const u = new URL(PG_URL);
  const pool = new Pool({
    host: u.hostname,
    port: Number(u.port),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, "") || "postgres",
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    // Per-connection setup: raise statement_timeout so big UPDATEs don't trip
    // Supabase's 120s default.
    statement_timeout: 15 * 60 * 1000,
  });

  // Don't crash on transient connection errors — Pool will re-establish.
  pool.on("error", (err) => {
    console.warn(`  pool error: ${err.message}`);
  });

  console.log("pool ready.\n");

  let totalP = 0;
  let totalE = 0;
  try {
    for (const t of TABLES) {
      if (TABLE_FILTER && t !== TABLE_FILTER) continue;
      const { processed, errors } = await reembedTable(pool, t);
      totalP += processed;
      totalE += errors;
    }
  } finally {
    await pool.end();
  }

  console.log("\n=== Done ===");
  console.log(`Processed: ${totalP.toLocaleString()}`);
  console.log(`Errors:    ${totalE}`);
  if (totalE > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
