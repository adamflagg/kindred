import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { AuthContext } from '../contexts/AuthContext'
import { ProgramProvider } from '../contexts/ProgramContext'
import { AdminRoute } from './AdminRoute'
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

describe('AdminRoute', () => {
  it('renders children when user is admin', () => {
    const user = createMockUser({ is_admin: true })
    const ctx = createMockAuthContext({ user })

    renderWithContext(ctx, createElement(AdminRoute, null, 'Admin Content'))
    expect(screen.getByText('Admin Content')).toBeTruthy()
  })

  it('shows restricted program switcher when user is not admin', () => {
    const user = createMockUser({ is_admin: false })
    const ctx = createMockAuthContext({ user })

    renderWithContext(ctx, createElement(AdminRoute, null, 'Admin Content'))
    expect(screen.queryByText('Admin Content')).toBeNull()
    expect(screen.getByText(/don't have access/i)).toBeTruthy()
  })

  it('shows loading spinner when auth is loading', () => {
    const ctx = {
      ...createMockAuthContext({ user: null }),
      isLoading: true,
    }

    renderWithContext(ctx, createElement(AdminRoute, null, 'Admin Content'))
    expect(screen.queryByText('Admin Content')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('renders children in bypass mode', () => {
    const ctx = createMockAuthContext({ user: null, isBypassMode: true })

    renderWithContext(ctx, createElement(AdminRoute, null, 'Bypass Content'))
    expect(screen.getByText('Bypass Content')).toBeTruthy()
  })
})
