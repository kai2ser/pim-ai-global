import OpenAI from "openai";
import { getServerEnv } from "@/lib/env";

// text-embedding-3-large produces 3072-dim vectors stored as halfvec(3072)
// in the chunk tables. All four collections share this model so retrieval
// uses a single embedding space across pim_literature, pima_reports,
// wbg_pers, and pefa_reports.
const EMBED_MODEL = "text-embedding-3-large";

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: getServerEnv().OPENAI_API_KEY });
  }
  return _openai;
}

export async function getEmbedding(text: string): Promise<number[]> {
  const cleaned = text.replace(/\n/g, " ").trim();
  if (!cleaned) return [];

  const response = await getOpenAI().embeddings.create({
    model: EMBED_MODEL,
    input: cleaned,
  });

  return response.data[0].embedding;
}

export async function getEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const cleaned = texts.map((t) => t.replace(/\n/g, " ").trim());
  const nonEmpty = cleaned.filter((t) => t.length > 0);

  if (nonEmpty.length === 0) return [];

  const response = await getOpenAI().embeddings.create({
    model: EMBED_MODEL,
    input: nonEmpty,
  });

  return response.data.map((d) => d.embedding);
}
