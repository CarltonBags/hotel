import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hoteloftware/domain", "@hoteloftware/db", "@hoteloftware/auth", "@hoteloftware/events", "@hoteloftware/payments", "@hoteloftware/invoices", "@hoteloftware/messaging", "@hoteloftware/storage", "@hoteloftware/channels", "@hoteloftware/ui"],
  serverExternalPackages: ["pg", "stripe"],
  agentRules: false,
  // the guest side's links carry the Portal Link's key: never sent on to other sites
  async headers() {
    return [{ source: "/g/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
  // City Tax evidence (up to 5 MB) and Maintenance photos (up to 10 MB) are uploaded through server actions
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  // the invoice and report PDFs embed these fonts, read from disk at render time
  outputFileTracingIncludes: { "/**": ["../../packages/invoices/fonts/**"] },
};

export default nextConfig;
