import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { AuthContext } from '../contexts/AuthContext'
import { RequirePermission } from './RequirePermission'
import type { RecordModel } from 'pocketbase'

function createMockAuthContext(overrides: {
  user?: RecordModel | null
  isBypassMode?: boolean
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
  }
}

function createMockUser(overrides: {
  is_admin?: boolean
  cached_permissions?: string[]
}): RecordModel {
  return {
    id: '1',
    collectionId: 'users',
    collectionName: 'users',
    created: '',
    updated: '',
    is_admin: overrides.is_admin ?? false,
    cached_permissions: overrides.cached_permissions ?? [],
  }
}

function renderWithContext(
  ctx: ReturnType<typeof createMockAuthContext>,
  element: React.ReactNode
) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(AuthContext.Provider, { value: ctx }, createElement(MemoryRouter, null, children))
  return render(element, { wrapper })
}

describe('RequirePermission', () => {
  it('renders children when user has required permission', () => {
    const user = createMockUser({ cached_permissions: ['bunking.view'] })
    const ctx = createMockAuthContext({ user })

    renderWithContext(
      ctx,
      createElement(RequirePermission, { permission: 'bunking.view', children: 'Protected Content' })
    )
    expect(screen.getByText('Protected Content')).toBeTruthy()
  })

  it('redirects when user lacks permission', () => {
    const user = createMockUser({ cached_permissions: ['metrics.view'] })
    const ctx = createMockAuthContext({ user })

    renderWithContext(
      ctx,
      createElement(RequirePermission, { permission: 'bunking.view', children: 'Protected' })
    )
    expect(screen.queryByText('Protected')).toBeNull()
  })

  it('renders children for admin regardless of permission', () => {
    const user = createMockUser({ is_admin: true, cached_permissions: [] })
    const ctx = createMockAuthContext({ user })

    renderWithContext(
      ctx,
      createElement(RequirePermission, { permission: 'bunking.manage', children: 'Admin Content' })
    )
    expect(screen.getByText('Admin Content')).toBeTruthy()
  })

  it('renders children in bypass mode', () => {
    const ctx = createMockAuthContext({ user: null, isBypassMode: true })

    renderWithContext(
      ctx,
      createElement(RequirePermission, { permission: 'bunking.manage', children: 'Bypass Content' })
    )
    expect(screen.getByText('Bypass Content')).toBeTruthy()
  })

  it('renders children when anyOf matches at least one permission', () => {
    const user = createMockUser({ cached_permissions: ['metrics.view'] })
    const ctx = createMockAuthContext({ user })

    renderWithContext(
      ctx,
      createElement(RequirePermission, {
        permission: '',
        anyOf: ['bunking.view', 'metrics.view'],
        children: 'AnyOf Content',
      })
    )
    expect(screen.getByText('AnyOf Content')).toBeTruthy()
  })
})
