/**
 * Tests for useIsAdmin hook
 *
 * Tests admin access control logic:
 * - Bypass mode = full access (dev environment)
 * - Empty admin ID = everyone is admin (default)
 * - Matching user ID = admin
 * - Non-matching user ID = not admin
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { useIsAdmin } from './useIsAdmin';
import type { RecordModel } from 'pocketbase';

// Helper to create mock auth context
function createMockAuthContext(overrides: {
  user?: RecordModel | null;
  isBypassMode?: boolean;
}) {
  return {
    pb: {} as never,
    user: overrides.user ?? null,
    isLoading: false,
    isAuthenticated: true,
    isBypassMode: overrides.isBypassMode ?? false,
    login: vi.fn(),
    logout: vi.fn(),
    error: null,
    checkAuth: vi.fn(),
  };
}

// Helper to create mock user
function createMockUser(id: string): RecordModel {
  return {
    id,
    collectionId: 'users',
    collectionName: 'users',
    created: '',
    updated: '',
    email: 'test@example.com',
  };
}

describe('useIsAdmin', () => {
  // Store original env value
  const originalEnv = import.meta.env['ADMIN_USER'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original env value
    import.meta.env['ADMIN_USER'] = originalEnv;
  });

  describe('bypass mode', () => {
    it('returns true when in bypass mode regardless of env var', () => {
      import.meta.env['ADMIN_USER'] = 'some-admin-id';
      const mockContext = createMockAuthContext({
        user: createMockUser('different-user'),
        isBypassMode: true,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children);

      const { result } = renderHook(() => useIsAdmin(), { wrapper });

      expect(result.current).toBe(true);
    });

    it('returns true when in bypass mode even with no user', () => {
      import.meta.env['ADMIN_USER'] = 'some-admin-id';
      const mockContext = createMockAuthContext({
        user: null,
        isBypassMode: true,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children);

      const { result } = renderHook(() => useIsAdmin(), { wrapper });

      expect(result.current).toBe(true);
    });
  });

  describe('no admin configured (default full access)', () => {
    it('returns true when ADMIN_USER is empty string', () => {
      import.meta.env['ADMIN_USER'] = '';
      const mockContext = createMockAuthContext({
        user: createMockUser('any-user'),
        isBypassMode: false,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children);

      const { result } = renderHook(() => useIsAdmin(), { wrapper });

      expect(result.current).toBe(true);
    });

    it('returns true when ADMIN_USER is undefined', () => {
      delete import.meta.env['ADMIN_USER'];
      const mockContext = createMockAuthContext({
        user: createMockUser('any-user'),
        isBypassMode: false,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children);

      const { result } = renderHook(() => useIsAdmin(), { wrapper });

      expect(result.current).toBe(true);
    });
  });

  describe('admin user ID configured', () => {
    it('returns true when user ID matches configured admin ID', () => {
      const adminId = 'admin-user-123';
      import.meta.env['ADMIN_USER'] = adminId;
      const mockContext = createMockAuthContext({
        user: createMockUser(adminId),
        isBypassMode: false,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children);

      const { result } = renderHook(() => useIsAdmin(), { wrapper });

      expect(result.current).toBe(true);
    });

    it('returns false when user ID does not match configured admin ID', () => {
      import.meta.env['ADMIN_USER'] = 'admin-user-123';
      const mockContext = createMockAuthContext({
        user: createMockUser('different-user-456'),
        isBypassMode: false,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children);

      const { result } = renderHook(() => useIsAdmin(), { wrapper });

      expect(result.current).toBe(false);
    });

    it('returns false when user is null', () => {
      import.meta.env['ADMIN_USER'] = 'admin-user-123';
      const mockContext = createMockAuthContext({
        user: null,
        isBypassMode: false,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children);

      const { result } = renderHook(() => useIsAdmin(), { wrapper });

      expect(result.current).toBe(false);
    });
  });

  describe('error handling', () => {
    it('throws error when used outside AuthProvider', () => {
      // Suppress console.error for expected error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useIsAdmin());
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });
});
