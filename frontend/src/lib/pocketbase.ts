import PocketBase, { type RecordModel } from 'pocketbase'
import type { TypedPocketBase } from '../types/pocketbase-types'

// Allow disabling auth for Playwright testing (set VITE_DISABLE_AUTH=true in .env)
const DISABLE_AUTH = import.meta.env['VITE_DISABLE_AUTH'] === 'true';

// Admin credentials for bypass mode (testing only)
// These are injected by Vite at build time when VITE_DISABLE_AUTH=true
// See vite.config.ts testAuthDefines - they come from POCKETBASE_ADMIN_* env vars
const BYPASS_ADMIN_EMAIL = import.meta.env['VITE_ADMIN_EMAIL'] || '';
const BYPASS_ADMIN_PASSWORD = import.meta.env['VITE_ADMIN_PASSWORD'] || '';

// Configure PocketBase URL based on access method
// IMPORTANT: The URL here must match EXACTLY what's configured in the OAuth2 provider's redirect URLs
const getApiUrl = () => {
  if (typeof window !== 'undefined') {
    // Use the full origin to ensure OAuth2 redirect_uri matches
    return window.location.origin;
  }
  // Fallback for SSR or non-browser environments
  return '';
};

export const pb = new PocketBase(getApiUrl()) as TypedPocketBase

// Disable auto-cancellation - React Query handles request deduplication and caching,
// PocketBase's collection-level cancellation conflicts with refetch behavior
pb.autoCancellation(false);

// Function to authenticate as admin in bypass mode
// Uses _superusers collection (PocketBase 0.23.0+ pattern, replacing deprecated pb.admins)
export async function authenticateBypassMode(): Promise<boolean> {
  try {
    await pb.collection('_superusers').authWithPassword(BYPASS_ADMIN_EMAIL, BYPASS_ADMIN_PASSWORD);
    return true;
  } catch (error) {
    console.error('Bypass mode: failed to authenticate with PocketBase admin', error);
    return false;
  }
}

// Define specific collection types for better typing
export interface SolverConfig extends RecordModel {
  config_key: string
  config_value: unknown
  description?: string
  category?: string
  data_type?: string
  min_value?: number
  max_value?: number
  default_value?: unknown
}

export interface AdminSetting extends RecordModel {
  key: string
  value: unknown
  description?: string
}

export interface SavedScenario extends RecordModel {
  name: string
  created_by: string
  session: string  // PocketBase relation ID
  year: number  // Year for filtering (matches session year)
  is_active?: boolean
  description?: string
  assignments_data?: unknown
  metadata?: unknown
  expand?: {
    session?: {
      id: string
      cm_id: number
      name: string
      [key: string]: unknown
    }
  }
}

// Get available auth methods
export async function getAuthMethods() {
  try {
    // Disable auto-cancellation for auth methods to avoid StrictMode issues
    const authMethods = await pb.collection('users').listAuthMethods({
      requestKey: null
    })
    return authMethods
  } catch (error) {
    console.error('Failed to fetch auth methods:', error)
    throw error
  }
}

// Login with OAuth2 provider
export async function loginWithOAuth2(provider: string) {
  try {
    // Let PocketBase SDK handle the popup automatically
    const authData = await pb.collection('users').authWithOAuth2({ 
      provider
      // SDK will open popup and handle OAuth2 flow via realtime connection
    })
    return authData
  } catch (error) {
    console.error(`OAuth2 login failed for provider ${provider}:`, error)
    throw error
  }
}


// Logout
export function logout() {
  pb.authStore.clear()
}

// Get current user (uses authStore.record - PocketBase 0.23.0+ pattern)
export function getCurrentUser() {
  if (!pb.authStore.isValid) return null
  return pb.authStore.record
}

// Get current user's email (centralized helper for audit trails)
export function getCurrentUserEmail(): string {
  return (pb.authStore.record?.['email'] as string) || 'unknown'
}

// Check if user is authenticated
export function isAuthenticated() {
  return pb.authStore.isValid
}

// Subscribe to auth state changes
export function onAuthChange(callback: (token: string | null, model: RecordModel | null) => void) {
  return pb.authStore.onChange(callback)
}

// Helper to handle PocketBase errors
interface PocketBaseError {
  status?: number;
  response?: { code?: number };
  data?: Record<string, { message?: string } | string>;
  message?: string;
}

export function handlePocketBaseError(error: unknown): string {
  const pbError = error as PocketBaseError | null;
  // Check for authentication errors (skip redirect when auth is disabled)
  if (!DISABLE_AUTH && (pbError?.status === 401 || pbError?.response?.code === 401)) {
    // Clear auth and redirect to login
    pb.authStore.clear()
    if (typeof window !== 'undefined') {
      window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`
    }
    return 'Session expired. Please log in again.'
  }

  if (pbError?.data) {
    // Extract validation errors
    const messages = Object.entries(pbError.data)
      .map(([field, err]) => {
        const errMessage = typeof err === 'object' && err !== null && 'message' in err ? err.message : String(err);
        return `${field}: ${errMessage}`;
      })
      .join(', ')
    return messages || pbError.message || 'An error occurred'
  }
  return pbError?.message || 'An error occurred'
}

// Add global error handling for 401 responses
pb.beforeSend = function (url, options) {
  // Just pass through - let the server validate tokens
  // The afterSend hook will handle any 401 responses
  return { url, options }
}

// Add afterSend hook to handle 401 responses globally (skip when auth is disabled)
pb.afterSend = function (response, data) {
  if (!DISABLE_AUTH && response.status === 401) {
    // Clear auth and redirect
    pb.authStore.clear()
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`
    }
  }
  return data
}