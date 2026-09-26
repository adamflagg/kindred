import { useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { pb } from '../lib/pocketbase'
import { viewAsHeaders } from '../auth/viewAs'

export interface FetchOptions extends RequestInit {
  skipAuth?: boolean
}

export function useApiWithAuth() {
  const { user, isLoading } = useAuth()

  const fetchWithAuth = useCallback(async (url: string, options: FetchOptions = {}) => {
    const { skipAuth = false, ...fetchOptions } = options

    // Initialize headers
    const headers = new Headers(fetchOptions.headers ?? {})

    // Add auth header if we have a token and auth is not skipped
    // Note: pb.authStore.token is read at call time, not dependency time
    if (!skipAuth && pb.authStore.token) {
      headers.set('Authorization', `Bearer ${pb.authStore.token}`)
    }

    // This tab's view-as persona; FastAPI honours it only for a real admin.
    for (const [name, value] of Object.entries(viewAsHeaders())) {
      headers.set(name, value)
    }

    // Always include credentials for cookie-based auth fallback
    const finalOptions: RequestInit = {
      ...fetchOptions,
      headers,
      credentials: 'include',
    }

    const response = await fetch(url, finalOptions)

    // Handle 401 globally: clear auth and redirect to login
    // This catches expired tokens on queries (not just mutations)
    if (response.status === 401) {
      pb.authStore.clear()
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`
      }
    }

    return response
  }, []) // pb.authStore.token is an outer scope value that doesn't trigger re-renders

  return { fetchWithAuth, isAuthenticated: !!user, isAuthLoading: isLoading }
}
