# pim-ai-global

AI-assisted semantic search and Q&A over four open collections of public-financial-management literature:

| Collection | Source | Documents |
|---|---|---|
| **PEFA National Reports** | [PEFA Secretariat](https://www.pefa.org) | Final, publicly-available country PEFA assessments |
| **IMF PIMA Reports** | [IMF Infrastructure Governance](https://infrastructuregovern.imf.org) | Public Investment Management Assessments (standard + climate) |
| **World Bank Public Finance Reviews** | [World Bank OKR](https://openknowledge.worldbank.org) | Public Expenditure & Public Finance Reviews |
| **Global PIM Good Practices** | World Bank, IMF, EC, EIB, JICA guidance | Curated PIM best-practice literature |

Live at **https://pim-ai-global.vercel.app**.

## Stack

Next.js 16 (App Router) on Vercel · Supabase Postgres with pgvector (HNSW indexes on `halfvec(3072)`) · OpenAI `text-embedding-3-large` for the shared embedding space · Anthropic Claude / OpenAI / Gemini / Mistral for the answer-generation step.

## Architecture in one paragraph

The four collections share a single `documents` registry and one chunk table per collection (`pefa_reports`, `pima_reports`, `wbg_pers`, `pim_literature`). Each chunk holds 3072-dim embeddings stored as `halfvec` for 50 % less storage at near-identical retrieval quality. Scrapers (`src/lib/scrapers/`) catalogue new documents into the registry; an ingest pipeline (`src/lib/ingest.ts`) downloads PDFs, chunks them with page-aware offsets, embeds the chunks, and promotes the documents row to `embedded`. A monthly Vercel cron re-runs the scrapers; the `/admin` page lets the operator trigger ad-hoc refresh + ingest runs and inspect recent activity.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Supabase + OpenAI + Anthropic keys
npm run dev
```

See [`AGENTS.md`](./AGENTS.md) for the operator runbook (admin token, bulk ingest, alerts) and [`CLAUDE.md`](./CLAUDE.md) for code-conventions notes.

## License

Code: MIT. Embedded report content remains under the publishing institutions' respective terms.
