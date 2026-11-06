import type { NextConfig } from "next";

// Static export: the dashboard is plain HTML + JS that talks to NEAR RPC and the wallet directly.
const config: NextConfig = {
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
};

export default config;
