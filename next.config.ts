import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'Referrer-Policy',
    value: 'origin-when-cross-origin'
  }
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/',
        has: [{ type: 'host', value: 'autometrics.vercel.app' }],
        destination: 'https://autometrics.cloud/',
        permanent: true,
      },
      {
        source: '/dashboard',
        has: [{ type: 'host', value: 'autometrics.vercel.app' }],
        destination: 'https://autometrics.cloud/dashboard',
        permanent: true,
      },
      {
        source: '/planning',
        has: [{ type: 'host', value: 'autometrics.vercel.app' }],
        destination: 'https://autometrics.cloud/planning',
        permanent: true,
      },
      {
        source: '/products',
        has: [{ type: 'host', value: 'autometrics.vercel.app' }],
        destination: 'https://autometrics.cloud/products',
        permanent: true,
      },
      {
        source: '/integration',
        has: [{ type: 'host', value: 'autometrics.vercel.app' }],
        destination: 'https://autometrics.cloud/integration',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
