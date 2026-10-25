import { resolve } from "node:path"
import type { NextConfig } from "next"
import { withVerificationResources } from "../../scripts/lib/verification-resources.mts"

const nextConfig: NextConfig = {
  transpilePackages: ["@browser-client/ui"],
  /* config options here */
  turbopack: {
    root: resolve(process.cwd(), "../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default withVerificationResources(nextConfig)
