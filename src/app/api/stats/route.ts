import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function getTableStats(
  supabase: ReturnType<typeof getServiceClient>,
  table: string,
  label: string
) {
  // Total count
  const { count: totalChunks } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });

  // Text chunks count
  const { count: textChunks } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("chunk_type", "text");

  // Image chunks count
  const { count: imageChunks } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("chunk_type", "image");

  // Unique documents — fetch all source_file values in pages
  const uniqueFiles = new Set<string>();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from(table)
      .select("source_file")
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    data.forEach((r: { source_file: string }) => uniqueFiles.add(r.source_file));
    if (data.length < 1000) break;
    offset += 1000;
  }

  return {
    collection_name: label,
    total_chunks: totalChunks || 0,
    text_chunks: textChunks || 0,
    image_chunks: imageChunks || 0,
    unique_documents: uniqueFiles.size,
    avg_content_length: 1000, // approximate — avoids expensive AVG scan
  };
}

export async function GET() {
  try {
    const supabase = getServiceClient();

    const [pimLit, pima, wbg] = await Promise.all([
      getTableStats(supabase, "pim_literature", "Global PIM Good Practices"),
      getTableStats(supabase, "pima_reports", "IMF PIMA Reports"),
      getTableStats(supabase, "wbg_pers", "World Bank PFRs"),
    ]);

    return NextResponse.json({ stats: [pimLit, pima, wbg] });
  } catch (err) {
    console.error("Stats API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
