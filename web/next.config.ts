import type { NextConfig } from "next";

// The api by container name, not service name: on the server's shared traefik network `api` is
// also a name other projects' containers answer to. Rewrites are fixed at build time.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://arc-vault-api:8000";

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
        destination: `${API_INTERNAL_URL}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${API_INTERNAL_URL}/health`,
      },
      {
        source: "/cdn/:path*",
        destination: "https://cdn.arctracker.io/:path*",
      },
    ];
  },
};

export default nextConfig;
