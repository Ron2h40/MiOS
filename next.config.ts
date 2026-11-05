import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  agentRules: false,
  async redirects() {
    return [{ source: "/", destination: "/m/general", permanent: false }];
  },
};

export default nextConfig;
