import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@beans/contracts", "@beans/ui"],
  poweredByHeader: false,
};

export default nextConfig;
