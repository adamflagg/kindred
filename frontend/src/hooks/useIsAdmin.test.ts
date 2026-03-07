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
import { createMockAuthContext, createMockUser } from '../test/test-helpers'

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
