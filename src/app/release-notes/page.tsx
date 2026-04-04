import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Release Notes",
  description:
    "Track the latest updates, new features, and improvements to the PIM AI Global platform.",
};

const releases = [
  {
    version: "v1.3.0",
    date: "April 2026",
    type: "Feature" as const,
    title: "Caching, Observability & Polish",
    items: [
      "Embedding cache: repeated queries skip the OpenAI embedding API call (30-day TTL, Supabase-backed)",
      "Response cache: identical query+collection+model combinations return instant cached answers (24-hour TTL)",
      "X-Cache HIT/MISS headers on all query responses for transparency",
      "Structured query logging with timing breakdown (embedding, retrieval, LLM generation)",
      "Analytics dashboard at /analytics with latency charts, cache hit rates, and token usage",
      "Copy-to-clipboard button on AI-generated answers",
      "Query history stored in localStorage with one-click recall",
      "Row-Level Security (RLS) enabled on all Supabase tables",
      "Environment variable validation via Zod at startup",
    ],
  },
  {
    version: "v1.2.0",
    date: "April 2026",
    type: "Feature" as const,
    title: "UX Quick Wins & Security Hardening",
    items: [
      "Markdown rendering for AI answers — headings, lists, bold, tables, code blocks display correctly",
      "Keyboard shortcut: Cmd/Ctrl+Enter submits query from the textarea",
      "SEO metadata: Open Graph tags, Twitter cards, and per-page titles across all pages",
      "Security headers: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy",
      "Accessibility improvements: ARIA labels on form controls, aria-live on streaming content, aria-expanded on mobile nav",
      "Updated tech specs and About page to reflect multi-LLM support",
    ],
  },
  {
    version: "v1.1.0",
    date: "April 2026",
    type: "Feature" as const,
    title: "Performance Optimization & Multi-LLM",
    items: [
      "Multi-LLM router: choose between Claude Sonnet, Claude Haiku, Claude Opus, GPT-4o, GPT-4o Mini, and o3-mini",
      "Response streaming via Server-Sent Events (SSE) — answers appear in real-time",
      "Rate limiting: 20 requests per minute per IP with Retry-After headers",
      "Stats endpoint optimization: 12 queries reduced to 3 parallel RPCs with 60s caching",
      "Code quality: runtime type validation, proper error handling, unique constraints on chunk tables",
      "Removed unused browser Supabase client, fixed page number calculation in ingestion",
    ],
  },
  {
    version: "v1.0.0",
    date: "April 2026",
    type: "Release" as const,
    title: "PIM AI Global — Initial Platform Launch",
    items: [
      "Launched PIM AI Global RAG platform with Next.js 16, Tailwind CSS, and TypeScript",
      "Three curated vector databases: Global PIM Good Practices, IMF PIMA Reports, and World Bank Public Finance Reviews",
      "Semantic search powered by OpenAI text-embedding-3-small (1,536 dimensions) with Supabase pgvector",
      "AI-powered answer generation with source citation",
      "Multi-format document ingestion pipeline supporting PDF, DOCX, and TXT files",
      "Real-time collection statistics dashboard with technical specifications",
      "Query interface with collection selector dropdown and similarity-ranked source display",
      "PIM PAM branding with official logo in header and footer",
      "Responsive design with dark navy header/footer matching pim-pam.ai styling",
      "Deployed on Vercel with environment-based configuration",
    ],
  },
  {
    version: "v0.1.0",
    date: "April 2026",
    type: "Feature" as const,
    title: "Document Ingestion & Vector Database Setup",
    items: [
      "Ingested 12 Global PIM Good Practices documents (~8,111 text chunks)",
      "Ingested 107 IMF PIMA Reports covering 30+ countries from 2016–2025 (~13,886 chunks)",
      "Ingested 316 World Bank Public Finance Reviews spanning 2015–2026 (~161,884 chunks)",
      "Supabase pgvector schema with IVFFlat indexing (100 lists) for fast cosine similarity search",
      "RPC functions for similarity matching and collection statistics aggregation",
      "Intelligent text chunking (1,000 chars with 200-char overlap) for optimal retrieval",
    ],
  },
];

const typeBadge = {
  Release: "bg-[#4472c4]/10 text-[#4472c4] border-[#4472c4]/20",
  Feature: "bg-teal-50 text-teal-700 border-teal-200",
};

export default function ReleaseNotesPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      {/* Header */}
      <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
        Changelog
      </p>
      <h1 className="font-heading text-3xl font-bold text-[#1d212b] md:text-4xl">
        Release Notes
      </h1>
      <p className="mt-3 max-w-2xl text-[#778899]">
        Track the latest updates, new features, and improvements to the PIM AI
        Global platform.
      </p>

      {/* Timeline */}
      <div className="relative mt-12 ml-4 border-l-2 border-[#4472c4]/30 pl-8">
        {releases.map((release, i) => (
          <div key={release.version} className={i > 0 ? "mt-12" : ""}>
            {/* Timeline dot */}
            <div className="absolute -left-[9px] mt-1.5 h-4 w-4 rounded-full border-2 border-[#4472c4] bg-white" />

            {/* Version + date + badge */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-heading text-lg font-bold text-[#1d212b]">
                {release.version}
              </span>
              <span className="text-sm text-[#778899]">{release.date}</span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${typeBadge[release.type]}`}
              >
                {release.type}
              </span>
            </div>

            {/* Title */}
            <h2 className="mt-2 font-heading text-xl font-semibold text-[#1d212b]">
              {release.title}
            </h2>

            {/* Items */}
            <ul className="mt-4 space-y-2">
              {release.items.map((item, j) => (
                <li key={j} className="flex items-start gap-3 text-sm leading-relaxed text-[#1d212b]">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#4472c4]/40" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
