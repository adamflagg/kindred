/**
 * Tests for useIsAdmin hook
 *
 * Tests that useIsAdmin delegates to usePermissions for admin status:
 * - Bypass mode = full access (dev environment)
 * - User with is_admin = true → admin
 * - User with is_admin = false → not admin
 * - No user → not admin
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { AuthContext } from '../contexts/AuthContext'
import { useIsAdmin } from './useIsAdmin'
import type { RecordModel } from 'pocketbase'

// Helper to create mock auth context
function createMockAuthContext(overrides: { user?: RecordModel | null; isBypassMode?: boolean }) {
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
  }
}

// Helper to create mock user with RBAC fields
function createMockUser(overrides: { is_admin?: boolean } = {}): RecordModel {
  return {
    id: 'user-1',
    collectionId: 'users',
    collectionName: 'users',
    created: '',
    updated: '',
    email: 'test@example.com',
    is_admin: overrides.is_admin ?? false,
    cached_permissions: [],
  }
}

describe('useIsAdmin', () => {
  describe('bypass mode', () => {
    it('returns true when in bypass mode', () => {
      const mockContext = createMockAuthContext({
        user: createMockUser({ is_admin: false }),
        isBypassMode: true,
      })

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children)

      const { result } = renderHook(() => useIsAdmin(), { wrapper })

      expect(result.current).toBe(true)
    })

    it('returns true when in bypass mode even with no user', () => {
      const mockContext = createMockAuthContext({
        user: null,
        isBypassMode: true,
      })

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children)

      const { result } = renderHook(() => useIsAdmin(), { wrapper })

      expect(result.current).toBe(true)
    })
  })

  describe('RBAC is_admin field', () => {
    it('returns true when user has is_admin = true', () => {
      const mockContext = createMockAuthContext({
        user: createMockUser({ is_admin: true }),
        isBypassMode: false,
      })

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children)

      const { result } = renderHook(() => useIsAdmin(), { wrapper })

      expect(result.current).toBe(true)
    })

    it('returns false when user has is_admin = false', () => {
      const mockContext = createMockAuthContext({
        user: createMockUser({ is_admin: false }),
        isBypassMode: false,
      })

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children)

      const { result } = renderHook(() => useIsAdmin(), { wrapper })

      expect(result.current).toBe(false)
    })

    it('returns false when user is null', () => {
      const mockContext = createMockAuthContext({
        user: null,
        isBypassMode: false,
      })

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: mockContext }, children)

      const { result } = renderHook(() => useIsAdmin(), { wrapper })

      expect(result.current).toBe(false)
    })
  })

  describe('error handling', () => {
    it('throws error when used outside AuthProvider', () => {
      // Suppress console.error for expected error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        renderHook(() => useIsAdmin())
      }).toThrow('useAuth must be used within an AuthProvider')

      consoleSpy.mockRestore()
    })
  })
})
