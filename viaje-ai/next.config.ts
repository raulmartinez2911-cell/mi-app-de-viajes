import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo lives inside a parent folder with its own package-lock.json;
  // pinning the root keeps Turbopack from scanning outside the project.
  turbopack: { root: __dirname },
};

export default nextConfig;
