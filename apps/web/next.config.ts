import type { NextConfig } from "next";

const internalApiBaseUrl = (process.env.INTERNAL_API_BASE_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ba-workbench/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${internalApiBaseUrl}/:path*`
      }
    ];
  }
};

export default nextConfig;
