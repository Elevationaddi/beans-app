import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@beans/contracts", "@beans/ui", "@beans/web"],
  poweredByHeader: false,
  // Pre-launch: keep every deployment (staging included) out of search engines unless a
  // production launch explicitly sets ALLOW_INDEXING=true.
  async headers() {
    if (process.env.ALLOW_INDEXING === "true") return [];
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default nextConfig;
