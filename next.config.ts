import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["nodegit"],
  typescript: { ignoreBuildErrors: true },
  allowedDevOrigins: ["100.64.164.2"],
};

export default nextConfig;
