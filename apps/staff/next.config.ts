import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hoteloftware/domain", "@hoteloftware/db", "@hoteloftware/auth", "@hoteloftware/events", "@hoteloftware/ui"],
  serverExternalPackages: ["pg"],
  agentRules: false,
};

export default nextConfig;
