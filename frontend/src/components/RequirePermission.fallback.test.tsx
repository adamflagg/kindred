import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RequirePermission } from './RequirePermission'

let allowed = false
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ isLoading: false }) }))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => allowed, hasAnyPermission: () => allowed }),
}))
vi.mock('../pages/PermissionDeniedPage', () => ({ default: () => <div>Permission denied</div> }))

describe('RequirePermission fallback', () => {
  it('shows the page a route names instead of the denied page, and the denied page by default', () => {
    allowed = false
    const { unmount } = render(
      <RequirePermission permission="x" fallback={<div>Not for you</div>}>
        <div>Secret</div>
      </RequirePermission>
    )
    expect(screen.getByText('Not for you')).toBeInTheDocument()
    expect(screen.queryByText('Secret')).toBeNull()
    unmount()
    render(
      <RequirePermission permission="x">
        <div>Secret</div>
      </RequirePermission>
    )
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it('shows the children to someone allowed', () => {
    allowed = true
    render(
      <RequirePermission permission="x" fallback={<div>Not for you</div>}>
        <div>Secret</div>
      </RequirePermission>
    )
    expect(screen.getByText('Secret')).toBeInTheDocument()
  })
})
