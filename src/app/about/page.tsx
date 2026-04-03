import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Learn about PIM AI Global, a RAG application for public investment management professionals with access to World Bank, IMF, and global guidance documents.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#4472c4]">
        About
      </p>
      <h1 className="font-heading text-3xl font-bold text-[#1d212b] md:text-4xl">
        PIM AI Global
      </h1>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-[#1d212b]">
        <p>
          PIM AI Global is a Retrieval-Augmented Generation (RAG) application
          designed for public investment management professionals, researchers,
          and policymakers. It provides AI-powered access to three curated
          collections of guidance documents from leading international
          institutions.
        </p>

        <h2 className="font-heading text-xl font-semibold text-[#1d212b]">
          Document Collections
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-[#dce4f0] bg-white p-5">
            <h3 className="font-heading font-semibold text-[#374696]">
              1. Global PIM Good Practices
            </h3>
            <p className="mt-2 text-[#778899]">
              Core reference materials from the World Bank, IMF, European
              Commission, European Investment Bank, and JICA covering best
              practices in public investment management, cost-benefit analysis,
              and climate-smart infrastructure.
            </p>
          </div>
          <div className="rounded-lg border border-[#dce4f0] bg-white p-5">
            <h3 className="font-heading font-semibold text-[#374696]">
              2. IMF PIMA Reports
            </h3>
            <p className="mt-2 text-[#778899]">
              IMF Public Investment Management Assessment (PIMA) reports
              evaluating countries&apos; institutional frameworks for managing
              public investment across the full project cycle.
            </p>
          </div>
          <div className="rounded-lg border border-[#dce4f0] bg-white p-5">
            <h3 className="font-heading font-semibold text-[#374696]">
              3. World Bank Public Finance Reviews
            </h3>
            <p className="mt-2 text-[#778899]">
              World Bank Public Expenditure Reviews (PERs) and Public Finance
              Reviews (PFRs) spanning 2015&ndash;2026, covering fiscal policy,
              expenditure efficiency, and public financial management across
              developing economies.
            </p>
          </div>
        </div>

        <h2 className="font-heading text-xl font-semibold text-[#1d212b]">
          Technology Stack
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-[#778899]">
          <li>
            <strong className="text-[#1d212b]">Frontend:</strong> Next.js 16, Tailwind CSS, TypeScript
          </li>
          <li>
            <strong className="text-[#1d212b]">Vector Database:</strong> Supabase
            with pgvector extension
          </li>
          <li>
            <strong className="text-[#1d212b]">Embeddings:</strong> OpenAI
            text-embedding-3-small (1536 dimensions)
          </li>
          <li>
            <strong className="text-[#1d212b]">LLM:</strong> Multi-model support
            (Anthropic Claude, OpenAI GPT-4o) for answer generation
          </li>
          <li>
            <strong className="text-[#1d212b]">Document Parsing:</strong>{" "}
            pdf-parse for PDFs, mammoth for DOCX files
          </li>
          <li>
            <strong className="text-[#1d212b]">Deployment:</strong> Vercel
          </li>
        </ul>
      </div>
    </div>
  );
}
