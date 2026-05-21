import type { NextConfig } from "next";

// All external origins our app fetches from at runtime. Keeping CSP tight
// prevents accidental data exfiltration if reflected XSS ever lands.
const CONNECT_SRC = [
  "'self'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
  "https://api.anthropic.com",
  "https://api.openai.com",
  "https://generativelanguage.googleapis.com",
  "https://api.mistral.ai",
  "https://vercel.live",
].join(" ");

const CSP = [
  `default-src 'self'`,
  // Next.js streams hydration/runtime JS inline; need unsafe-inline for that
  // and unsafe-eval for some legacy chunks. Tighten later via nonces.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src ${CONNECT_SRC}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "Content-Security-Policy", value: CSP },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // Belt-and-braces: tell crawlers to ignore the analytics endpoint
        source: "/api/analytics",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
