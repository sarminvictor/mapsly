import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // nodemailer + imapflow use dynamic requires — keep them external so the
  // cold-mailer (cron + admin seed test) and the cold-inbox poller work in
  // the Vercel serverless runtime, not just local tsx. Without this, the
  // bundled copies fail at runtime.
  serverExternalPackages: ["nodemailer", "imapflow"],
  experimental: {
    cacheComponents: true,
    inlineCss: true,
    authInterrupts: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
