/**
 * Tests for AuthContext - authentication state management
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

// Type for mocked fetch function - includes mock methods
import type { Mock } from 'vitest';
type MockedFetch = Mock;

// Mock the pocketbase module - factory must not reference external variables
vi.mock('../lib/pocketbase', () => {
  const mockAuthStore = {
    isValid: false,
    token: null as string | null,
    model: null as unknown,
    clear: vi.fn(),
    onChange: vi.fn(),
  };

  return {
    pb: {
      authStore: mockAuthStore,
      collection: vi.fn(),
    },
    loginWithOAuth2: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(() => null),
    isAuthenticated: vi.fn(() => false),
    onAuthChange: vi.fn(() => vi.fn()), // Returns unsubscribe function
    authenticateBypassMode: vi.fn(),
  };
});

// Test component that uses the auth context
function TestConsumer() {
  const { user, isLoading, isAuthenticated, isBypassMode, error } = useAuth();
  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'ready'}</div>
      <div data-testid="authenticated">{isAuthenticated ? 'yes' : 'no'}</div>
      <div data-testid="bypass">{isBypassMode ? 'bypass' : 'production'}</div>
      <div data-testid="user">{user?.['email'] || 'no-user'}</div>
      <div data-testid="error">{error || 'no-error'}</div>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    globalThis.fetch = vi.fn() as unknown as MockedFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useAuth hook', () => {
    it('throws error when used outside AuthProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestConsumer />);
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('AuthProvider', () => {
    it('shows loading state initially', async () => {
      // Mock fetch to return bypass mode
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'bypass' }),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      // Should show loading initially
      expect(screen.getByTestId('loading').textContent).toBe('loading');
    });

    it('fetches auth config on mount', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'production' }),
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/config');
      });
    });

    it('defaults to production mode when config fetch fails', async () => {
      (globalThis.fetch as MockedFetch).mockRejectedValue(new Error('Network error'));

      const { authenticateBypassMode } = await import('../lib/pocketbase');

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        // Should not call bypass authentication
        expect(authenticateBypassMode).not.toHaveBeenCalled();
      });
    });

    it('defaults to production mode when config response is not ok', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: false,
        status: 500,
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('bypass').textContent).toBe('production');
      });
    });
  });

  describe('bypass mode', () => {
    it('sets bypass user when in bypass mode', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'bypass' }),
      });

      const { authenticateBypassMode } = await import('../lib/pocketbase');
      vi.mocked(authenticateBypassMode).mockResolvedValue(true);

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('bypass').textContent).toBe('bypass');
      });
    });

    it('is always authenticated in bypass mode', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'bypass' }),
      });

      const { authenticateBypassMode, isAuthenticated } = await import('../lib/pocketbase');
      vi.mocked(authenticateBypassMode).mockResolvedValue(true);
      vi.mocked(isAuthenticated).mockReturnValue(false); // Even if PB says false

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        // Bypass mode should always show authenticated
        expect(screen.getByTestId('authenticated').textContent).toBe('yes');
      });
    });

    it('sets error when bypass auth fails', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'bypass' }),
      });

      const { authenticateBypassMode } = await import('../lib/pocketbase');
      vi.mocked(authenticateBypassMode).mockResolvedValue(false);

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Failed to authenticate in bypass mode');
      });
    });
  });

  describe('production mode', () => {
    it('uses real auth state in production mode', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'production' }),
      });

      const { isAuthenticated } = await import('../lib/pocketbase');
      vi.mocked(isAuthenticated).mockReturnValue(false);

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated').textContent).toBe('no');
        expect(screen.getByTestId('bypass').textContent).toBe('production');
      });
    });

    it('clears admin tokens in production mode', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'production' }),
      });

      const { getCurrentUser, pb } = await import('../lib/pocketbase');
      // Return an admin user (superusers collection)
      vi.mocked(getCurrentUser).mockReturnValue({
        id: 'admin-id',
        collectionId: '_superusers',
        collectionName: '_superusers',
        email: 'admin@test.com',
        created: '',
        updated: '',
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        // Admin token should be cleared
        expect(pb.authStore.clear).toHaveBeenCalled();
      });
    });
  });

  describe('production mode token validation', () => {
    it('validates cached token with backend on mount', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'production' }),
      });

      const { getCurrentUser, pb } = await import('../lib/pocketbase');

      // Return a cached user (regular users collection)
      const cachedUser = {
        id: 'user-123',
        collectionId: 'users',
        collectionName: 'users',
        email: 'cached@test.com',
        created: '',
        updated: '',
      };
      vi.mocked(getCurrentUser).mockReturnValue(cachedUser);

      // Mock successful authRefresh with updated user data
      const refreshedUser = {
        id: 'user-123',
        collectionId: 'users',
        collectionName: 'users',
        email: 'refreshed@test.com',
        created: '',
        updated: '',
      };
      const mockAuthRefresh = vi.fn().mockResolvedValue({ record: refreshedUser });
      vi.mocked(pb.collection).mockReturnValue({ authRefresh: mockAuthRefresh } as ReturnType<typeof pb.collection>);

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        // Should have called authRefresh to validate token
        expect(pb.collection).toHaveBeenCalledWith('users');
        expect(mockAuthRefresh).toHaveBeenCalled();
      });

      await waitFor(() => {
        // Should use the refreshed user data
        expect(screen.getByTestId('user').textContent).toBe('refreshed@test.com');
      });
    });

    it('clears auth and sets user to null when token is invalid (401)', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'production' }),
      });

      const { getCurrentUser, pb, isAuthenticated } = await import('../lib/pocketbase');

      // Return a cached user
      const cachedUser = {
        id: 'user-123',
        collectionId: 'users',
        collectionName: 'users',
        email: 'stale@test.com',
        created: '',
        updated: '',
      };
      vi.mocked(getCurrentUser).mockReturnValue(cachedUser);
      vi.mocked(isAuthenticated).mockReturnValue(false);

      // Mock authRefresh to fail with 401
      const mockAuthRefresh = vi.fn().mockRejectedValue({ status: 401 });
      vi.mocked(pb.collection).mockReturnValue({ authRefresh: mockAuthRefresh } as ReturnType<typeof pb.collection>);

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        // Should clear auth store on 401
        expect(pb.authStore.clear).toHaveBeenCalled();
      });

      await waitFor(() => {
        // User should be null after invalid token
        expect(screen.getByTestId('user').textContent).toBe('no-user');
        expect(screen.getByTestId('authenticated').textContent).toBe('no');
      });
    });

    it('uses cached user on network error for graceful degradation', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'production' }),
      });

      const { getCurrentUser, pb, isAuthenticated } = await import('../lib/pocketbase');

      // Return a cached user
      const cachedUser = {
        id: 'user-123',
        collectionId: 'users',
        collectionName: 'users',
        email: 'cached@test.com',
        created: '',
        updated: '',
      };
      vi.mocked(getCurrentUser).mockReturnValue(cachedUser);
      vi.mocked(isAuthenticated).mockReturnValue(true);

      // Mock authRefresh to fail with network error (no status)
      const mockAuthRefresh = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.mocked(pb.collection).mockReturnValue({ authRefresh: mockAuthRefresh } as ReturnType<typeof pb.collection>);

      // Suppress console.warn for this test
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        // Should NOT clear auth store on network error
        expect(pb.authStore.clear).not.toHaveBeenCalled();
      });

      await waitFor(() => {
        // Should still use cached user for graceful degradation
        expect(screen.getByTestId('user').textContent).toBe('cached@test.com');
        expect(screen.getByTestId('authenticated').textContent).toBe('yes');
      });

      consoleSpy.mockRestore();
    });

    it('skips backend validation when no cached token exists', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'production' }),
      });

      const { getCurrentUser, pb } = await import('../lib/pocketbase');

      // No cached user
      vi.mocked(getCurrentUser).mockReturnValue(null);

      const mockAuthRefresh = vi.fn();
      vi.mocked(pb.collection).mockReturnValue({ authRefresh: mockAuthRefresh } as ReturnType<typeof pb.collection>);

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('ready');
      });

      // Should NOT have called authRefresh when there's no cached user
      expect(mockAuthRefresh).not.toHaveBeenCalled();
      expect(screen.getByTestId('user').textContent).toBe('no-user');
    });
  });

  describe('BYPASS_USER constant', () => {
    it('has correct properties for mock user', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'bypass' }),
      });

      const { authenticateBypassMode } = await import('../lib/pocketbase');
      vi.mocked(authenticateBypassMode).mockResolvedValue(true);

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        // Bypass user should have bypass@local email
        expect(screen.getByTestId('user').textContent).toBe('bypass@local');
      });
    });
  });
});
