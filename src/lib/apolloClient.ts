'use client';

import { ApolloClient, InMemoryCache, HttpLink, split } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { setContext } from '@apollo/client/link/context';
import nhost from './nhost';

function createApolloClient(accessToken?: string | null) {
  const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN;
  const region = process.env.NEXT_PUBLIC_NHOST_REGION || 'eu-central-1';

  const httpUrl = `https://${subdomain}.hasura.${region}.nhost.run/v1/graphql`;
  const wsUrl = `wss://${subdomain}.hasura.${region}.nhost.run/v1/graphql`;

  const authLink = setContext(async (_, { headers }) => {
    const token = accessToken || nhost.auth.getAccessToken();
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
        const token = accessToken || nhost.auth.getAccessToken();
        return token
          ? { headers: { Authorization: `Bearer ${token}` } }
          : {};
      },
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
        workflow_runs: {
          fields: {
            step_runs: { merge: false },
          },
        },
      },
    }),
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'cache-and-network',
      },
    },
  });
}

// Singleton client
let apolloClient: ApolloClient<any> | null = null;

export function getApolloClient(accessToken?: string | null) {
  if (!apolloClient) {
    apolloClient = createApolloClient(accessToken);
  }
  return apolloClient;
}

export function resetApolloClient() {
  apolloClient = null;
}
