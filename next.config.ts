import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    localPatterns: [
      {
        pathname: "/api/comfy/history-image",
      },
    ],
  },
};

export default nextConfig;
