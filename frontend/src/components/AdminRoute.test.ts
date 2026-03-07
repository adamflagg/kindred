import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { AuthContext } from '../contexts/AuthContext'
import { ProgramProvider } from '../contexts/ProgramContext'
import { AdminRoute } from './AdminRoute'
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
    createElement(
      AuthContext.Provider,
      { value: ctx },
      createElement(MemoryRouter, null, createElement(ProgramProvider, null, children))
    )
  return render(element, { wrapper })
}

describe('AdminRoute', () => {
  it('renders children when user is admin', () => {
    const user = createMockUser({ is_admin: true })
    const ctx = createMockAuthContext({ user })

    renderWithContext(ctx, createElement(AdminRoute, { children: 'Admin Content' }))
    expect(screen.getByText('Admin Content')).toBeTruthy()
  })

  it('shows restricted program switcher when user is not admin', () => {
    const user = createMockUser({ is_admin: false })
    const ctx = createMockAuthContext({ user })

    renderWithContext(ctx, createElement(AdminRoute, { children: 'Admin Content' }))
    expect(screen.queryByText('Admin Content')).toBeNull()
    expect(screen.getByText(/don't have access/i)).toBeTruthy()
  })

  it('shows loading spinner when auth is loading', () => {
    const ctx = {
      ...createMockAuthContext({ user: null }),
      isLoading: true,
    }

    renderWithContext(ctx, createElement(AdminRoute, { children: 'Admin Content' }))
    expect(screen.queryByText('Admin Content')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('renders children in bypass mode', () => {
    const ctx = createMockAuthContext({ user: null, isBypassMode: true })

    renderWithContext(ctx, createElement(AdminRoute, { children: 'Bypass Content' }))
    expect(screen.getByText('Bypass Content')).toBeTruthy()
  })
})
