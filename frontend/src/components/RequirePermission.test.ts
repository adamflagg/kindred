import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { AuthContext } from '../contexts/AuthContext'
import { ProgramProvider } from '../contexts/ProgramContext'
import { RequirePermission } from './RequirePermission'
import { createMockAuthContext, createMockUser } from '../test/test-helpers'

function renderWithContext(
  ctx: ReturnType<typeof createMockAuthContext>,
  element: React.ReactNode
) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(
      AuthContext.Provider,
      { value: ctx },
      createElement(MemoryRouter, null, createElement(ProgramProvider, null, children))
    )
  return render(element, { wrapper })
}

describe('RequirePermission', () => {
  it('renders children when user has required permission', () => {
    const user = createMockUser({ cached_permissions: ['bunking.manage'] })
    const ctx = createMockAuthContext({ user })

    renderWithContext(
      ctx,
      createElement(RequirePermission, {
        permission: 'bunking.manage',
        children: 'Protected Content',
      })
    )
    expect(screen.getByText('Protected Content')).toBeTruthy()
  })

  it('shows restricted page when user lacks permission', () => {
    const user = createMockUser({ cached_permissions: ['metrics.financial'] })
    const ctx = createMockAuthContext({ user })

    renderWithContext(
      ctx,
      createElement(RequirePermission, { permission: 'bunking.manage', children: 'Protected' })
    )
    expect(screen.queryByText('Protected')).toBeNull()
    expect(screen.getByText(/Access Restricted/i)).toBeTruthy()
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
    const user = createMockUser({ cached_permissions: ['metrics.financial'] })
    const ctx = createMockAuthContext({ user })

    renderWithContext(
      ctx,
      createElement(RequirePermission, {
        anyOf: ['bunking.manage', 'metrics.financial'],
        children: 'AnyOf Content',
      })
    )
    expect(screen.getByText('AnyOf Content')).toBeTruthy()
  })

  it('shows loading spinner when auth is loading', () => {
    const ctx = {
      ...createMockAuthContext({ user: null }),
      isLoading: true,
    }

    renderWithContext(
      ctx,
      createElement(RequirePermission, {
        permission: 'bunking.manage',
        children: 'Protected Content',
      })
    )
    // Should not show content or navigate — should show loading indicator
    expect(screen.queryByText('Protected Content')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('shows permission denied page when permission denied', () => {
    const user = createMockUser({ cached_permissions: [] })
    const ctx = createMockAuthContext({ user })

    renderWithContext(
      ctx,
      createElement(RequirePermission, {
        permission: 'bunking.manage',
        children: 'Protected Content',
      })
    )
    expect(screen.queryByText('Protected Content')).toBeNull()
    // Should show the access denied message instead of redirecting
    expect(screen.getByText(/Access Restricted/i)).toBeTruthy()
  })
})
