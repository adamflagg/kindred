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
      (authenticateBypassMode as any).mockResolvedValue(true);

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
      (authenticateBypassMode as any).mockResolvedValue(true);
      (isAuthenticated as any).mockReturnValue(false); // Even if PB says false

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
      (authenticateBypassMode as any).mockResolvedValue(false);

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
      (isAuthenticated as any).mockReturnValue(false);

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
      (getCurrentUser as any).mockReturnValue({
        id: 'admin-id',
        collectionName: '_superusers',
        email: 'admin@test.com',
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

  describe('BYPASS_USER constant', () => {
    it('has correct properties for mock user', async () => {
      (globalThis.fetch as MockedFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ auth_mode: 'bypass' }),
      });

      const { authenticateBypassMode } = await import('../lib/pocketbase');
      (authenticateBypassMode as any).mockResolvedValue(true);

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
