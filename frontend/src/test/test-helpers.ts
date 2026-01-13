import { QueryClient } from '@tanstack/react-query';

// Create a custom query client for tests
export const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: 0,
      staleTime: 0,
    },
  },
});