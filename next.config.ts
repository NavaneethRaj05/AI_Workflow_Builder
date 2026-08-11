import type { NextConfig } from "next";

const NHOST_SUBDOMAIN = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'bykigbyxcjykjxbhakqc';
const NHOST_REGION = process.env.NEXT_PUBLIC_NHOST_REGION || 'ap-south-1';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Proxy nhost auth requests to avoid CORS issues from the browser
      {
        source: '/nhost/auth/:path*',
        destination: `https://${NHOST_SUBDOMAIN}.auth.${NHOST_REGION}.nhost.run/v1/:path*`,
      },
      // Proxy nhost GraphQL requests
      {
        source: '/nhost/graphql/:path*',
        destination: `https://${NHOST_SUBDOMAIN}.hasura.${NHOST_REGION}.nhost.run/v1/graphql/:path*`,
      },
      // Proxy nhost functions
      {
        source: '/nhost/functions/:path*',
        destination: `https://${NHOST_SUBDOMAIN}.functions.${NHOST_REGION}.nhost.run/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
