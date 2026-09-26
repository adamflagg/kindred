import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { AuthContext } from '../contexts/AuthContext'
import { usePermissions } from './usePermissions'
import { createMockAuthContext, createMockUser } from '../test/test-helpers'
import { writeViewAs } from '../auth/viewAs'

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

  describe('view-as persona', () => {
    beforeEach(() => window.sessionStorage.clear())
    const registrar = {
      label: 'Registrar',
      source: 'role' as const,
      permissions: ['metrics.geo', 'registration.manage'],
    }
    const renderFor = (user: ReturnType<typeof createMockUser> | null, isBypassMode = false) => {
      const ctx = createMockAuthContext({ user, isBypassMode })
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(AuthContext.Provider, { value: ctx }, children)
      return renderHook(() => usePermissions(), { wrapper }).result.current
    }

    it('downgrades a real admin to the persona', () => {
      writeViewAs(registrar)
      const perms = renderFor(
        createMockUser({ is_admin: true, cached_permissions: ['sheets.export'] })
      )
      expect(perms.isAdmin).toBe(false)
      expect(perms.realIsAdmin).toBe(true)
      expect(perms.viewAs).toEqual(registrar)
      expect(perms.permissions).toEqual(['metrics.geo', 'registration.manage'])
      expect(perms.hasPermission('registration.manage')).toBe(true)
      expect(perms.hasPermission('sheets.export')).toBe(false)
      expect(perms.hasAnyPermission('bunking.manage', 'metrics.geo')).toBe(true)
    })

    it('ignores a stored persona for a real non-admin', () => {
      writeViewAs(registrar)
      const perms = renderFor(createMockUser({ cached_permissions: ['bunking.manage'] }))
      expect(perms.isAdmin).toBe(false)
      expect(perms.realIsAdmin).toBe(false)
      expect(perms.viewAs).toBeNull()
      expect(perms.permissions).toEqual(['bunking.manage'])
    })

    it('ignores a stored persona in bypass mode', () => {
      writeViewAs(registrar)
      const perms = renderFor(null, true)
      expect(perms.isAdmin).toBe(true)
      expect(perms.viewAs).toBeNull()
    })

    it('reports real access when not previewing', () => {
      const perms = renderFor(createMockUser({ is_admin: true }))
      expect(perms.isAdmin).toBe(true)
      expect(perms.realIsAdmin).toBe(true)
      expect(perms.viewAs).toBeNull()
    })
  })
})
