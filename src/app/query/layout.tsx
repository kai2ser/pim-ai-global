import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Query",
  description:
    "Search across public investment management document collections using AI-powered semantic search with source citations.",
};

export default function QueryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
