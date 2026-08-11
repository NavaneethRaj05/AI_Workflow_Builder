import { NhostClient } from '@nhost/nhost-js';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'bykigbyxcjykjxbhakqc';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || 'ap-south-1';

// Use direct nhost cloud URLs — the nhost auth service allows all origins by default.
// If CORS issues persist in production, the Next.js rewrites in next.config.ts
// provide a proxy at /nhost/auth/* that can be used as authUrl instead.
export const nhost = new NhostClient({
  subdomain,
  region,
});

export default nhost;
