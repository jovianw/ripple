import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /live became /system when it was narrowed to the system index.
  async redirects() {
    return [{ source: "/live", destination: "/system", permanent: false }];
  },
};

export default nextConfig;
