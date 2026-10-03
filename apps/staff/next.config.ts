import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hoteloftware/domain", "@hoteloftware/db", "@hoteloftware/auth", "@hoteloftware/events", "@hoteloftware/payments", "@hoteloftware/invoices", "@hoteloftware/ui"],
  serverExternalPackages: ["pg", "stripe"],
  agentRules: false,
  // City Tax evidence documents (up to 5 MB) are uploaded through a server action
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
