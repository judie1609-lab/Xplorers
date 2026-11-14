import type { NextConfig } from "next";

const isStaticExport = process.env.NEXT_STATIC_EXPORT === "true";
const enzonicBackendOrigin = (
  process.env.ENZONIC_BACKEND_ORIGIN || "http://fr-one.enzonic.com:26111"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Vercel needs the Next.js server runtime to proxy the browser's same-origin
  // API, health, and static-image requests to the Enzonic FastAPI service.
  // Keep an explicit static-export mode for hosts that provide their own proxy.
  ...(isStaticExport ? { output: "export" as const } : {}),
  async rewrites() {
    if (isStaticExport) return [];

    return [
      {
        source: "/api/:path*",
        destination: `${enzonicBackendOrigin}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${enzonicBackendOrigin}/health`,
      },
      {
        source: "/static/:path*",
        destination: `${enzonicBackendOrigin}/static/:path*`,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
