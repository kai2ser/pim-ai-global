import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="bg-[#1c2027] text-gray-400">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-8 md:grid-cols-3">
          {/* Brand */}
          <div>
            <Link href="/" className="flex items-center">
              <Image
                src="/logo-pimpam.png"
                alt="PIM PAM"
                width={219}
                height={94}
                className="h-8 w-auto brightness-0 invert"
              />
            </Link>
            <p className="mt-3 text-sm leading-relaxed">
              AI-powered retrieval and analysis of global public investment
              management guidance, IMF PIMA reports, and World Bank public
              finance reviews.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">Navigation</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/" className="hover:text-[#8bb8e8]">Home</Link></li>
              <li><Link href="/release-notes" className="hover:text-[#8bb8e8]">Release Notes</Link></li>
              <li><Link href="/query" className="hover:text-[#8bb8e8]">Query</Link></li>
              <li><Link href="/statistics" className="hover:text-[#8bb8e8]">Statistics</Link></li>
              <li><Link href="/about" className="hover:text-[#8bb8e8]">About</Link></li>
            </ul>
          </div>

          {/* Info */}
          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">Document Collections</h4>
            <ul className="space-y-2 text-sm">
              <li>Global PIM Good Practices</li>
              <li>IMF PIMA Reports</li>
              <li>World Bank Public Finance Reviews</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-gray-500">
          &copy; {new Date().getFullYear()} PIM AI Global. Built with Next.js, Supabase &amp; OpenAI.
        </div>
      </div>
    </footer>
  );
}
