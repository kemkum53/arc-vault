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
        // Container name, not service name: on the server's shared traefik network `api` is also
        // a name other projects' containers answer to.
        destination: "http://arc-vault-api:8000/api/:path*",
      },
      {
        source: "/health",
        destination: "http://arc-vault-api:8000/health",
      },
      {
        source: "/cdn/:path*",
        destination: "https://cdn.arctracker.io/:path*",
      },
    ];
  },
};

export default nextConfig;
