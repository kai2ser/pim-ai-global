import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

// Cache stats for 60 seconds to avoid hammering the DB
export const revalidate = 60;

interface StatsRow {
  total_chunks: number;
  text_chunks: number;
  image_chunks: number;
  unique_documents: number;
  avg_content_length: number;
}

const COLLECTIONS = [
  { rpc: "stats_pim_literature", label: "Global PIM Good Practices" },
  { rpc: "stats_pima_reports", label: "IMF PIMA Reports" },
  { rpc: "stats_wbg_pers", label: "World Bank PFRs" },
] as const;

export async function GET() {
  try {
    const supabase = getServiceClient();

    // 3 parallel RPC calls — each is a single optimized SQL query
    const results = await Promise.all(
      COLLECTIONS.map(async (col) => {
        const { data, error } = await supabase.rpc(col.rpc);

        if (error) {
          console.error(`Stats RPC error for ${col.rpc}:`, error.message);
          // Return zeros on error instead of failing the whole request
          return {
            collection_name: col.label,
            total_chunks: 0,
            text_chunks: 0,
            image_chunks: 0,
            unique_documents: 0,
            avg_content_length: 0,
          };
        }

        const row: StatsRow | undefined =
          Array.isArray(data) && data.length > 0 ? data[0] : data ?? undefined;

        return {
          collection_name: col.label,
          total_chunks: row?.total_chunks ?? 0,
          text_chunks: row?.text_chunks ?? 0,
          image_chunks: row?.image_chunks ?? 0,
          unique_documents: row?.unique_documents ?? 0,
          avg_content_length: row?.avg_content_length ?? 0,
        };
      })
    );

    return NextResponse.json(
      { stats: results },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (err) {
    console.error("Stats API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
