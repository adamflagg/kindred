import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { pb } from '../lib/pocketbase';

export interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

export function useApiWithAuth() {
  const { user } = useAuth();

  const fetchWithAuth = useCallback(async (url: string, options: FetchOptions = {}) => {
    const { skipAuth = false, ...fetchOptions } = options;

    // Initialize headers
    const headers = new Headers(fetchOptions.headers || {});

    // Add auth header if we have a token and auth is not skipped
    // Note: pb.authStore.token is read at call time, not dependency time
    if (!skipAuth && pb.authStore.token) {
      headers.set('Authorization', `Bearer ${pb.authStore.token}`);
    }

    // Always include credentials for cookie-based auth fallback
    const finalOptions: RequestInit = {
      ...fetchOptions,
      headers,
      credentials: 'include' as RequestCredentials,
    };

    return fetch(url, finalOptions);
  }, []); // pb.authStore.token is an outer scope value that doesn't trigger re-renders

  return { fetchWithAuth, isAuthenticated: !!user };
}