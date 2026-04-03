import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Statistics",
  description:
    "Real-time overview of vector database collections for PIM AI Global, including chunk counts, document coverage, and embedding specifications.",
};

export default function StatisticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
