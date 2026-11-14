import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This application fetches live data from FastAPI in the browser. It does not
  // need a Next.js runtime server, so Render can serve the generated `out/` site.
  output: "export",
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
