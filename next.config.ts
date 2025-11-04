import type { NextConfig } from "next";

const nextConfig: NextConfig = {
   experimental: {
    serverActions: {
      // aceita '10mb', '50mb', '100mb'…
      bodySizeLimit: '50mb',
    },
  },
  images: {
    // 1) Libera os hosts mais comuns do WhatsApp/Facebook CDN
    remotePatterns: [
      { protocol: 'https', hostname: 'pps.whatsapp.net' },
      { protocol: 'https', hostname: '**.whatsapp.net' },
      { protocol: 'https', hostname: 'scontent.xx.fbcdn.net' },
      { protocol: 'https', hostname: 'scontent-**.fbcdn.net' },
      { protocol: 'https', hostname: '**.fbcdn.net' },
    ],
  },
};

export default nextConfig;
