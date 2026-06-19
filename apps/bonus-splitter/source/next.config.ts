import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "/myportfolio/apps/bonus-splitter",
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || "/myportfolio/apps/bonus-splitter",
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
