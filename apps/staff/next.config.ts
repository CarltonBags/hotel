import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hoteloftware/domain", "@hoteloftware/db", "@hoteloftware/auth", "@hoteloftware/events", "@hoteloftware/payments", "@hoteloftware/invoices", "@hoteloftware/ui"],
  serverExternalPackages: ["pg", "stripe"],
  agentRules: false,
};

export default nextConfig;
