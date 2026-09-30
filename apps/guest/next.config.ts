import type { NextConfig } from "next";

/** Guest-facing app (portal, kiosk, tablet). Carries no staff code and deploys separately. */
const nextConfig: NextConfig = {
  transpilePackages: ["@hoteloftware/ui"],
  agentRules: false,
};

export default nextConfig;
