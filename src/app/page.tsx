import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Search,
  Database,
  FileText,
  BarChart3,
  Globe,
  BookOpen,
} from "lucide-react";
import {
  COLLECTIONS,
  getServiceClient,
  type CollectionName,
} from "@/lib/supabase";

// Architecture-diagram boxes display the live unique-document count per
// collection. We regenerate the page at most once per 60 s; in between,
// every visit is served from the static cache for free.
export const revalidate = 60;

// Display order for the four collection boxes — kept explicit (not derived
// from the COLLECTIONS array) so the homepage layout doesn't shift if the
// underlying registration order changes.
const COLLECTION_BOXES: Array<{ id: CollectionName; label: string }> = [
  { id: "pim_literature", label: "Global PIM Literature" },
  { id: "pima_reports", label: "IMF PIMA Reports" },
  { id: "pefa_reports", label: "PEFA National Reports" },
  { id: "wbg_pers", label: "World Bank PFRs" },
];

// Last-known-good counts. Used when the per-collection stats RPC errors out
// (DB transient, build-time fetch can't reach Supabase, etc.) so the
// architecture diagram never shows "0 docs". Keep these roughly current —
// they're cosmetic, not the primary source of truth.
const FALLBACK_COUNTS: Record<CollectionName, number> = {
  pim_literature: 12,
  pima_reports: 107,
  pefa_reports: 227,
  wbg_pers: 317,
};

async function getCollectionDocCounts(): Promise<Record<CollectionName, number>> {
  try {
    const supabase = getServiceClient();
    const entries = await Promise.all(
      COLLECTIONS.map(async (col): Promise<[CollectionName, number]> => {
        const { data, error } = await supabase.rpc(col.statsFn);
        if (error) return [col.id, FALLBACK_COUNTS[col.id]];
        const row = Array.isArray(data) && data.length > 0 ? data[0] : data;
        const n = (row as { unique_documents?: number } | null)?.unique_documents;
        return [col.id, typeof n === "number" ? n : FALLBACK_COUNTS[col.id]];
      })
    );
    return Object.fromEntries(entries) as Record<CollectionName, number>;
  } catch {
    return FALLBACK_COUNTS;
  }
}

const features = [
  {
    icon: Search,
    title: "Semantic Search",
    description:
      "Query across four curated document collections using state-of-the-art vector embeddings and retrieval-augmented generation.",
  },
  {
    icon: Database,
    title: "Four Vector Databases",
    description:
      "Separate, optimized vector stores for Global PIM Literature, IMF PIMA Reports, PEFA National Reports, and World Bank Public Finance Reviews.",
  },
  {
    icon: FileText,
    title: "Multi-Format Ingestion",
    description:
      "Automatically parse and index PDF, Word (.docx), and text documents with intelligent chunking and metadata extraction.",
  },
  {
    icon: BarChart3,
    title: "Collection Analytics",
    description:
      "View real-time statistics on each vector database including chunk counts, document coverage, and embedding dimensions.",
  },
  {
    icon: Globe,
    title: "Multi-Modal RAG",
    description:
      "Extract and embed both text and images from documents for comprehensive, multi-modal retrieval and analysis.",
  },
  {
    icon: BookOpen,
    title: "AI-Powered Answers",
    description:
      "Get contextual, cited answers powered by Claude with source attribution back to the original documents and pages.",
  },
];

export default async function Home() {
  const docCounts = await getCollectionDocCounts();
  return (
    <>
      {/* Hero */}
      <section className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
            Public Investment Management Intelligence
          </p>
          <h1 className="font-heading text-4xl font-bold leading-tight text-[#1d212b] md:text-5xl lg:text-6xl">
            AI-Powered Access to Global
            <br />
            <span className="text-[#4472c4]">PIM Knowledge</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#778899]">
            Search and analyze guidance from leading international institutions.
            Extract insights from World Bank, IMF, and global best practice
            documents on public investment management.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button asChild size="lg">
              <Link href="/query">Start Querying</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/statistics">View Statistics</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-[#f0f5ff]/50 py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
            Capabilities
          </p>
          <h2 className="font-heading text-3xl font-bold text-[#1d212b]">
            What This Platform Offers
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-[#dce4f0] bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <f.icon className="mb-4 h-8 w-8 text-[#4472c4]" />
                <h3 className="font-heading text-lg font-semibold text-[#1d212b]">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#778899]">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture Overview */}
      <section className="bg-white py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
            Architecture
          </p>
          <h2 className="font-heading text-3xl font-bold text-[#1d212b]">
            How It Works
          </h2>
          <div className="mt-10 flex flex-col items-center gap-4">
            {/* Input */}
            <div className="w-full max-w-md rounded-lg border-2 border-[#4472c4] bg-[#4472c4]/5 p-4 text-center">
              <p className="font-heading font-semibold text-[#374696]">
                User Query
              </p>
              <p className="mt-1 text-sm text-[#778899]">
                Natural language question about PIM
              </p>
            </div>
            <div className="h-8 w-px bg-[#4472c4]" />
            {/* Middle */}
            <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {COLLECTION_BOXES.map((col) => (
                <div
                  key={col.id}
                  className="rounded-lg border border-[#dce4f0] bg-white p-4 text-center shadow-sm"
                >
                  <Database className="mx-auto mb-2 h-6 w-6 text-[#4472c4]" />
                  <p className="text-sm font-semibold text-[#1d212b]">
                    {col.label}
                  </p>
                  <p className="mt-1 text-xs text-[#778899]">
                    {docCounts[col.id].toLocaleString()} docs
                  </p>
                </div>
              ))}
            </div>
            <div className="h-8 w-px bg-[#4472c4]" />
            {/* Output */}
            <div className="w-full max-w-md rounded-lg border-2 border-[#4472c4] bg-[#4472c4]/5 p-4 text-center">
              <p className="font-heading font-semibold text-[#374696]">
                AI-Generated Answer
              </p>
              <p className="mt-1 text-sm text-[#778899]">
                With source citations and relevant excerpts
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#1c2027] py-16 text-center">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="font-heading text-2xl font-bold text-white md:text-3xl">
            Ready to Explore PIM Knowledge?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[#99a2af]">
            Start querying across four comprehensive document collections
            covering global public investment management practices.
          </p>
          <div className="mt-8">
            <Button
              asChild
              size="lg"
              className="bg-[#4472c4] hover:bg-[#374696]"
            >
              <Link href="/query">Launch Query Interface</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
