import type { NextConfig } from "next";

const pythonBackendUrl =
  process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8001";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.scdn.co",
      },
      {
        protocol: "https",
        hostname: "mosaic.scdn.co",
      },
      {
        protocol: "https",
        hostname: "image-cdn-ak.spotifycdn.com",
      },
    ],
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${pythonBackendUrl}/api/:path*`,
        },
        {
          source: "/callbacks",
          destination: `${pythonBackendUrl}/callbacks`,
        },
        {
          source: "/callbacks/:path*",
          destination: `${pythonBackendUrl}/callbacks/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
