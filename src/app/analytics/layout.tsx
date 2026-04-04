import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analytics",
  description:
    "Query performance analytics, cache hit rates, and usage metrics for PIM AI Global.",
};

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
