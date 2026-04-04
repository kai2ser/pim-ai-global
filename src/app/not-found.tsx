import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Search, Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#f0f5ff]">
        <Search className="h-10 w-10 text-[#4472c4]" />
      </div>

      <h1 className="font-heading text-4xl font-bold text-[#1d212b]">
        Page Not Found
      </h1>
      <p className="mt-4 max-w-md text-[#778899]">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
        Try searching our document collections or head back to the home page.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Button asChild size="lg">
          <Link href="/query">
            <Search className="mr-2 h-4 w-4" />
            Search Documents
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/">
            <Home className="mr-2 h-4 w-4" />
            Home
          </Link>
        </Button>
      </div>

      <Link
        href="javascript:history.back()"
        className="mt-6 flex items-center gap-1 text-sm text-[#4472c4] hover:text-[#374696]"
      >
        <ArrowLeft className="h-3 w-3" />
        Go back
      </Link>
    </div>
  );
}
