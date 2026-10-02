import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { makeProps } from './testFixtures'
import type { UsersPageProps } from './types'

let mockIsAdmin = true

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: vi.fn(),
    hasAnyPermission: vi.fn(),
    isAdmin: mockIsAdmin,
    permissions: [],
  }),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-admin' },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}))
vi.mock('./RoleDrawer', () => ({
  RoleDrawer: ({ roleId, onClose }: { roleId: string | null; onClose: () => void }) => (
    <div data-testid="role-drawer">
      {roleId ?? 'new'}
      <button type="button" data-testid="close-drawer" onClick={onClose} />
    </div>
  ),
}))

const { RolesMatrix } = await import('./RolesMatrix')

function renderMatrix(
  url: Partial<UsersPageProps['url']> = {},
  mutate?: (p: ReturnType<typeof makeProps>) => void
) {
  const props = makeProps(url)
  mutate?.(props)
  render(
    <MemoryRouter>
      <RolesMatrix {...props} />
    </MemoryRouter>
  )
  return props
}

beforeEach(() => {
  mockIsAdmin = true
})

describe('RolesMatrix', () => {
  it('rows are permissions under area headings; columns are Admin then each role', () => {
    renderMatrix()
    const headers = within(screen.getByTestId('roles-matrix'))
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers[0]).toMatch(/Permission/)
    expect(headers[1]).toMatch(/^Admin/)
    expect(screen.getByRole('row', { name: /Analytics/ })).toBeInTheDocument()
  })

  it('does not mark which roles are system roles', () => {
    renderMatrix()
    expect(
      within(screen.getByTestId('roles-matrix')).queryByText(/^System$/)
    ).not.toBeInTheDocument()
  })

  it('counts people per role from live links, and links the count to Users', async () => {
    const url = renderMatrix().url
    expect(screen.getByTestId('role-count-r-exec')).toHaveTextContent('2 people') // admin + Emma; orphan l5 ignored
    await userEvent.click(screen.getByTestId('role-count-r-exec'))
    expect(url.setRole).toHaveBeenCalledWith('r-exec')
    expect(screen.getByTestId('role-count-r-empty')).toHaveTextContent('no one')
  })

  it('the Admin header count filters Users to the admin bucket (#22)', async () => {
    const url = renderMatrix().url
    await userEvent.click(screen.getByRole('button', { name: '1 person' }))
    expect(url.setBucket).toHaveBeenCalledWith('admin')
  })

  it('keeps the area label in view while the matrix scrolls sideways', () => {
    renderMatrix()
    const label = screen.getByText('Analytics', { selector: 'td span' })
    expect(label.className).toMatch(/sticky/)
  })

  it('pins the permission column for horizontal scroll (R3)', () => {
    renderMatrix()
    expect(screen.getByTestId('matrix-pin-metrics.geo').className).toMatch(/sticky/)
    expect(screen.getByTestId('matrix-scroll').className).toMatch(/overflow-x-auto/)
  })

  it('a permission label jumps to the Permissions tab (R5)', async () => {
    const url = renderMatrix().url
    await userEvent.click(screen.getByRole('button', { name: 'Geographic data' }))
    expect(url.setTab).toHaveBeenCalledWith('permissions', 'metrics.geo')
  })

  it('a role name opens the role drawer', async () => {
    renderMatrix()
    await userEvent.click(screen.getByTestId('role-open-r-fin'))
    expect(screen.getByTestId('role-drawer')).toHaveTextContent('r-fin')
  })

  it('opens the drawer for the role named by url.focus', () => {
    renderMatrix({ tab: 'roles', focus: 'r-fin' })
    expect(screen.getByTestId('role-drawer')).toHaveTextContent('r-fin')
  })

  it.each(['metrics.geo', 'r-gone'])('a focus of %s that is not a role opens nothing', (focus) => {
    renderMatrix({ tab: 'roles', focus })
    expect(screen.queryByTestId('role-drawer')).not.toBeInTheDocument()
  })

  it('closing a focus-opened drawer clears the focus from the URL', async () => {
    const url = renderMatrix({ tab: 'roles', focus: 'r-fin' }).url
    await userEvent.click(screen.getByTestId('close-drawer'))
    expect(url.setTab).toHaveBeenCalledWith('roles')
  })

  it('flags a permission no screen checks', () => {
    renderMatrix()
    expect(screen.getByTestId('matrix-pin-metrics.financial')).toHaveTextContent(
      'not checked anywhere'
    )
    expect(screen.getByTestId('matrix-pin-metrics.geo')).not.toHaveTextContent(
      'not checked anywhere'
    )
  })

  it('only admins see New role, and it opens the drawer for a new role', async () => {
    renderMatrix()
    await userEvent.click(screen.getByRole('button', { name: /New role/ }))
    expect(screen.getByTestId('role-drawer')).toHaveTextContent('new')
  })

  it('hides New role from non-admins, whose role names still open the drawer', async () => {
    mockIsAdmin = false
    renderMatrix()
    expect(screen.queryByRole('button', { name: /New role/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('role-open-r-exec'))
    expect(screen.getByTestId('role-drawer')).toHaveTextContent('r-exec')
  })

  it.each([
    ['loading', { data: undefined, isLoading: true, error: null }],
    ['failed', { data: undefined, isLoading: false, error: new Error('boom') }],
  ])('falls back to bare codenames under no area while the registry is %s', (_n, reg) => {
    renderMatrix({}, (p) => {
      p.registry = reg as unknown as UsersPageProps['registry']
    })
    const matrix = screen.getByTestId('roles-matrix')
    // union of role.permissions, as bare codenames
    for (const code of [
      'bunking.manage',
      'metrics.geo',
      'users.manage',
      'financial_aid.view',
      'sheets.export',
      'staff.hiring',
    ]) {
      expect(within(matrix).getByRole('button', { name: code })).toBeInTheDocument()
    }
    expect(screen.queryByRole('row', { name: /Analytics/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Geographic data')).not.toBeInTheDocument()
    expect(screen.getByTestId('matrix-pin-metrics.geo')).toBeInTheDocument()
  })
})
