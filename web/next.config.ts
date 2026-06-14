import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.arctracker.io" },
    ],
  },
  async headers() {
    return [
      {
        source: "/extensions/:path*.xpi",
        headers: [
          { key: "Content-Type", value: "application/x-xpinstall" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://api:8000/api/:path*",
      },
      {
        source: "/health",
        destination: "http://api:8000/health",
      },
      {
        source: "/cdn/:path*",
        destination: "https://cdn.arctracker.io/:path*",
      },
    ];
  },
};

export default nextConfig;
