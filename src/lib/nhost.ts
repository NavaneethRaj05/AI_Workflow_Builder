import { NhostClient } from '@nhost/nhost-js';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'bykigbyxcjykjxbhakqc';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || 'ap-south-1';

const isBrowser = typeof window !== 'undefined';

// Do NOT pass `subdomain` or `region` to NhostClient constructor.
// If `subdomain` is present in options, @nhost/nhost-js internal logic overrides authUrl!
// By omitting `subdomain` and `region`, @nhost/nhost-js uses `authUrl` and `graphqlUrl` exactly as provided.
export const nhost = new NhostClient({
  authUrl: isBrowser ? `${window.location.origin}/nhost/auth` : `https://${subdomain}.auth.${region}.nhost.run/v1`,
  graphqlUrl: isBrowser ? `${window.location.origin}/nhost/graphql` : `https://${subdomain}.graphql.${region}.nhost.run/v1`,
  storageUrl: `https://${subdomain}.storage.${region}.nhost.run/v1`,
  functionsUrl: `https://${subdomain}.functions.${region}.nhost.run/v1`,
});

export default nhost;
