import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@repairflow/config", "@repairflow/contracts"],
};

export default nextConfig;
