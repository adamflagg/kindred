import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { AuthContext } from '../contexts/AuthContext'
import { usePermissions } from './usePermissions'
import type { RecordModel } from 'pocketbase'

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

function createMockUser(overrides: {
  is_admin?: boolean
  cached_permissions?: string[]
}): RecordModel {
  return {
    id: 'user-1',
    collectionId: 'users',
    collectionName: 'users',
    created: '',
    updated: '',
    is_admin: overrides.is_admin ?? false,
    cached_permissions: overrides.cached_permissions ?? [],
  }
}

describe('usePermissions', () => {
  it('returns hasPermission that checks cached_permissions', () => {
    const user = createMockUser({ cached_permissions: ['bunking.view', 'metrics.view'] })
    const ctx = createMockAuthContext({ user })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(AuthContext.Provider, { value: ctx }, children)

    const { result } = renderHook(() => usePermissions(), { wrapper })

    expect(result.current.hasPermission('bunking.view')).toBe(true)
    expect(result.current.hasPermission('bunking.manage')).toBe(false)
  })

  it('admin bypasses all permission checks', () => {
    const user = createMockUser({ is_admin: true, cached_permissions: [] })
    const ctx = createMockAuthContext({ user })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(AuthContext.Provider, { value: ctx }, children)

    const { result } = renderHook(() => usePermissions(), { wrapper })

    expect(result.current.hasPermission('bunking.manage')).toBe(true)
    expect(result.current.hasPermission('anything')).toBe(true)
    expect(result.current.isAdmin).toBe(true)
  })

  it('bypass mode grants all permissions', () => {
    const ctx = createMockAuthContext({ user: null, isBypassMode: true })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(AuthContext.Provider, { value: ctx }, children)

    const { result } = renderHook(() => usePermissions(), { wrapper })

    expect(result.current.hasPermission('anything')).toBe(true)
    expect(result.current.isAdmin).toBe(true)
  })

  it('hasAnyPermission returns true if user has at least one', () => {
    const user = createMockUser({ cached_permissions: ['metrics.view'] })
    const ctx = createMockAuthContext({ user })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(AuthContext.Provider, { value: ctx }, children)

    const { result } = renderHook(() => usePermissions(), { wrapper })

    expect(result.current.hasAnyPermission('bunking.view', 'metrics.view')).toBe(true)
    expect(result.current.hasAnyPermission('bunking.view', 'bunking.manage')).toBe(false)
  })

  it('no user returns no permissions', () => {
    const ctx = createMockAuthContext({ user: null })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(AuthContext.Provider, { value: ctx }, children)

    const { result } = renderHook(() => usePermissions(), { wrapper })

    expect(result.current.hasPermission('bunking.view')).toBe(false)
    expect(result.current.isAdmin).toBe(false)
    expect(result.current.permissions).toEqual([])
  })

  it('throws error when used outside AuthProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => usePermissions())
    }).toThrow('useAuth must be used within an AuthProvider')

    consoleSpy.mockRestore()
  })
})
