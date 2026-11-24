import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  agentRules: false,
  async redirects() {
    return [
      { source: "/", destination: "/m/general", permanent: false },
      // Job hunt mode became Work.
      { source: "/m/job-hunt", destination: "/m/work", permanent: true },
    ];
  },
};

export default nextConfig;
