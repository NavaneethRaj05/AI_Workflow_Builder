import { NhostClient } from '@nhost/nhost-js';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'bykigbyxcjykjxbhakqc';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || 'ap-south-1';

const isBrowser = typeof window !== 'undefined';
const authUrl = isBrowser ? `${window.location.origin}/nhost/auth` : `https://${subdomain}.auth.${region}.nhost.run/v1`;
const graphqlUrl = `https://${subdomain}.graphql.${region}.nhost.run/v1`;

export const nhost = new NhostClient({
  authUrl,
  graphqlUrl,
  subdomain,
  region,
});

export default nhost;
