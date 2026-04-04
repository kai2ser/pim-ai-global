import type { Metadata } from "next";
import { Inter, Fira_Sans } from "next/font/google";
import Header from "@/components/header";
import Footer from "@/components/footer";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  weight: ["400", "600", "700"],
  subsets: ["latin"],
});

const SITE_URL = "https://pim-ai-global.vercel.app";

export const metadata: Metadata = {
  title: {
    default: "PIM AI Global — Public Investment Management Intelligence",
    template: "%s | PIM AI Global",
  },
  description:
    "AI-powered retrieval and analysis of global public investment management guidance, IMF PIMA reports, and World Bank public finance reviews.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "PIM AI Global",
    title: "PIM AI Global — Public Investment Management Intelligence",
    description:
      "AI-powered search across World Bank, IMF, and global best practice documents on public investment management.",
  },
  twitter: {
    card: "summary_large_image",
    title: "PIM AI Global",
    description:
      "AI-powered search across World Bank, IMF, and global PIM guidance documents.",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${firaSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
