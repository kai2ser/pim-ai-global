import OpenAI from "openai";
import { getServerEnv } from "@/lib/env";

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
    model: "text-embedding-3-small",
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
    model: "text-embedding-3-small",
    input: nonEmpty,
  });

  return response.data.map((d) => d.embedding);
}
