/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  env: {},
  async rewrites() {
    return [
      { source: "/v1/v1/:path*", destination: "/api/v1/:path*" },
      { source: "/v1/v1", destination: "/api/v1" },
      { source: "/codex/:path*", destination: "/api/v1/responses" },
      { source: "/v1/:path*", destination: "/api/v1/:path*" },
      { source: "/v1", destination: "/api/v1" },
    ];
  },
};

export default nextConfig;
