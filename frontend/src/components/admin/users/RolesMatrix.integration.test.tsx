import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { Role } from '../../../types/rbac'
import { makeProps, ROLES } from './testFixtures'
import { queryKeys } from '../../../utils/queryKeys'
import { rolesByUser } from './usersPageModel'

// The server's roles; a create adds to it, and the refetch answers a beat later.
const server: Role[] = [...ROLES]

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: vi.fn(),
    hasAnyPermission: vi.fn(),
    isAdmin: true,
    permissions: [],
  }),
}))
vi.mock('../../../hooks/usePermissionDescriptions', () => ({
  usePermissionDescriptions: () => ({ data: undefined }),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-admin' }, isLoading: false, isAuthenticated: true }),
}))
vi.mock('../../../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      create: async (body: Record<string, unknown>) => {
        const rec = { id: 'r-new', ...body } as unknown as Role
        server.push(rec)
        return rec
      },
    }),
  },
}))

const { RolesMatrix } = await import('./RolesMatrix')

/** Roles come from a query that resolves late, like the real refetch. */
function Harness() {
  const base = makeProps()
  const q = useQuery({
    queryKey: queryKeys.roles(),
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 30))
      return [...server]
    },
  })
  const roles = q.data ?? ROLES
  const roleLikes = roles.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    permissions: r.permissions,
  }))
  const held = rolesByUser(
    base.data.users.map((u) => ({ id: u.id, is_admin: Boolean(u['is_admin']) })),
    base.data.userRoles,
    roleLikes
  )
  return <RolesMatrix {...base} data={{ ...base.data, roles, roleLikes, held }} />
}

describe('RolesMatrix with the real RoleDrawer', () => {
  it('opens the new role without the drawer ever disappearing', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: /New role/ }))
    await userEvent.type(screen.getByLabelText('Name'), 'Health Center')

    let vanished = false
    const snap: string[] = []
    const watch = new MutationObserver(() => {
      if (!screen.queryByTestId('role-drawer')) {
        vanished = true
        snap.push(document.body.innerHTML.slice(0, 400))
      }
    })
    watch.observe(document.body, { childList: true, subtree: true })

    await userEvent.click(screen.getByRole('button', { name: 'Create role' }))
    await waitFor(() =>
      expect(screen.getByTestId('role-drawer')).toHaveTextContent('Health Center')
    )
    watch.disconnect()
    expect(snap).toEqual([])
  })
})
