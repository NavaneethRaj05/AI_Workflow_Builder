'use client';

import { ApolloClient, InMemoryCache, HttpLink, split, ApolloProvider } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { setContext } from '@apollo/client/link/context';
import { NhostProvider } from '@nhost/react';
import { Toaster } from 'react-hot-toast';
import nhost from '@/lib/nhost';
import { useMemo } from 'react';

function ApolloWrapper({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => {
    const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local';
    const region = process.env.NEXT_PUBLIC_NHOST_REGION || 'eu-central-1';

    const httpUrl = subdomain === 'local'
      ? 'http://localhost:8080/v1/graphql'
      : `https://${subdomain}.graphql.${region}.nhost.run/v1`;
    const wsUrl = subdomain === 'local'
      ? 'ws://localhost:8080/v1/graphql'
      : `wss://${subdomain}.graphql.${region}.nhost.run/v1`;

    const authLink = setContext(async (_, { headers }) => {
      const token = nhost.auth.getAccessToken();
      return {
        headers: {
          ...headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      };
    });

    const httpLink = new HttpLink({ uri: httpUrl });

    const wsLink = new GraphQLWsLink(
      createClient({
        url: wsUrl,
        connectionParams: async () => {
          const token = nhost.auth.getAccessToken();
          return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
        },
        retryAttempts: 5,
        shouldRetry: () => true,
      })
    );

    const splitLink = split(
      ({ query }) => {
        const definition = getMainDefinition(query);
        return (
          definition.kind === 'OperationDefinition' &&
          definition.operation === 'subscription'
        );
      },
      wsLink,
      authLink.concat(httpLink)
    );

    return new ApolloClient({
      link: splitLink,
      cache: new InMemoryCache({
        typePolicies: {
          workflow_runs: { fields: { step_runs: { merge: false } } },
          Query: { fields: { step_runs: { merge: false } } },
        },
      }),
      defaultOptions: {
        watchQuery: { fetchPolicy: 'cache-and-network' },
      },
    });
  }, []);

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NhostProvider nhost={nhost}>
      <ApolloWrapper>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#131926',
              color: '#f0f4ff',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: '10px',
              fontFamily: 'Inter, sans-serif',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#34d399', secondary: '#131926' } },
            error: { iconTheme: { primary: '#f87171', secondary: '#131926' } },
          }}
        />
        {children}
      </ApolloWrapper>
    </NhostProvider>
  );
}
