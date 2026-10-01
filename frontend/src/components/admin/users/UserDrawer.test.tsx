import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { makeProps, USERS } from './testFixtures'
import { queryKeys } from '../../../utils/queryKeys'

const ops: Array<[string, unknown]> = []
let sendFails = false
let mockIsAdmin = false

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: vi.fn(),
    hasAnyPermission: vi.fn(),
    isAdmin: mockIsAdmin,
    permissions: [],
  }),
}))
vi.mock('../../../lib/pocketbase', () => ({
  pb: {
    files: { getURL: vi.fn() },
    createBatch: () => ({
      collection: () => ({
        create: (body: unknown) => ops.push(['create', body]),
        delete: (id: string) => ops.push(['delete', id]),
      }),
      send: () =>
        sendFails ? Promise.reject(new Error('Failed to create record.')) : Promise.resolve([]),
    }),
  },
}))

const { UserDrawer } = await import('./UserDrawer')

type Props = ReturnType<typeof makeProps>

function drawerTree(
  client: QueryClient,
  userId: string,
  data: Props['data'],
  registry: Props['registry']
) {
  const user = USERS.find((u) => u.id === userId)!
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UserDrawer user={user} data={data} registry={registry} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function renderDrawer(userId: string, opts: { noRegistry?: boolean } = {}) {
  const props = makeProps()
  const registry = opts.noRegistry
    ? ({ data: undefined, isLoading: true, error: null } as unknown as Props['registry'])
    : props.registry
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(drawerTree(client, userId, props.data, registry))
  return {
    client,
    props,
    rerenderWith: (id: string, data: Props['data'] = props.data) =>
      view.rerender(drawerTree(client, id, data, registry)),
  }
}

beforeEach(() => {
  ops.length = 0
  sendFails = false
  mockIsAdmin = false
})

describe('UserDrawer', () => {
  it('lists their roles first, then one-line "Add a role" rows', () => {
    renderDrawer('u-emma')
    expect(screen.getByRole('heading', { name: /Emma's roles\s*2/ })).toBeInTheDocument()
    expect(screen.getByTestId('add-role-r-fin')).toHaveTextContent(
      '2 permissions: Family detail, Google Sheets export'
    )
  })

  it('flags a redundant role (U10c)', () => {
    renderDrawer('u-emma')
    expect(screen.getByTestId('role-row-r-bunk')).toHaveTextContent(
      'Adds nothing: Executive already grants all of this.'
    )
  })

  it('ticks build a draft; nothing writes until Save (U10b)', async () => {
    renderDrawer('u-emma')
    await userEvent.click(screen.getByRole('checkbox', { name: /Finance/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Bunking Staff/ }))
    expect(ops).toEqual([])
    expect(screen.getByTestId('drawer-footer')).toHaveTextContent(
      '2 changes: + Finance · − Bunking Staff'
    )
    expect(screen.getByTestId('can-do')).toHaveTextContent('after saving')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(ops).toEqual([
      ['create', { user: 'u-emma', role: 'r-fin' }],
      ['delete', 'l2'],
    ])
  })

  it('shows what they can do by area, with via (U10d)', () => {
    renderDrawer('u-emma')
    expect(screen.getByTestId('can-do')).toHaveTextContent('via Executive, Bunking Staff')
  })

  it('Discard drops the draft', async () => {
    renderDrawer('u-emma')
    await userEvent.click(screen.getByRole('checkbox', { name: /Finance/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByTestId('drawer-footer')).toHaveTextContent('No changes')
  })

  it('keeps the draft and says so when the save is refused (Review Focus 3)', async () => {
    sendFails = true
    renderDrawer('u-emma')
    await userEvent.click(screen.getByRole('checkbox', { name: /Finance/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/Nothing was changed/)).toBeInTheDocument()
    expect(screen.getByTestId('drawer-footer')).toHaveTextContent('1 change: + Finance')
  })

  it('shows the empty state for someone with no roles', () => {
    renderDrawer('u-olivia')
    expect(screen.getByText(/No roles yet\. They can sign in/)).toBeInTheDocument()
  })

  describe('users.manage is admin-only (R9)', () => {
    it('disables the role for a non-admin, with the reason, and a click changes nothing', async () => {
      renderDrawer('u-olivia')
      const box = screen.getByRole('checkbox', { name: /Executive/ })
      expect(box).toBeDisabled()
      expect(screen.getByTestId('add-role-r-exec')).toHaveTextContent(
        'Only admins can give or remove user management'
      )
      await userEvent.click(box)
      await userEvent.click(screen.getByText('Executive'))
      expect(screen.getByTestId('drawer-footer')).toHaveTextContent('No changes')
    })

    it('also locks a held users.manage role against removal', async () => {
      renderDrawer('u-emma')
      const box = screen.getByRole('checkbox', { name: /Executive/ })
      expect(box).toBeDisabled()
      expect(screen.getByTestId('role-row-r-exec')).toHaveTextContent(
        'Only admins can give or remove user management'
      )
      await userEvent.click(box)
      expect(screen.getByTestId('drawer-footer')).toHaveTextContent('No changes')
    })

    it('lets an admin toggle it', async () => {
      mockIsAdmin = true
      renderDrawer('u-olivia')
      const box = screen.getByRole('checkbox', { name: /Executive/ })
      expect(box).toBeEnabled()
      await userEvent.click(box)
      expect(screen.getByTestId('drawer-footer')).toHaveTextContent('1 change: + Executive')
    })
  })

  it('lets an admin remove a held users.manage role', async () => {
    mockIsAdmin = true
    renderDrawer('u-emma')
    await userEvent.click(screen.getByRole('checkbox', { name: /Executive/ }))
    expect(screen.getByTestId('drawer-footer')).toHaveTextContent('1 change: − Executive')
  })

  it('flags a ticked "Add a role" row that adds nothing (U10c)', async () => {
    mockIsAdmin = true
    renderDrawer('u-olivia')
    await userEvent.click(screen.getByRole('checkbox', { name: /Executive/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Bunking Staff/ }))
    expect(screen.getByTestId('add-role-r-bunk')).toHaveTextContent(
      'Adds nothing: Executive already grants all of this.'
    )
  })

  describe('after a save and across props', () => {
    it('invalidates both user-role queries on success', async () => {
      const { client } = renderDrawer('u-emma')
      const spy = vi.spyOn(client, 'invalidateQueries')
      await userEvent.click(screen.getByRole('checkbox', { name: /Finance/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.userRoles() }))
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.userRolesForUser('u-emma') })
    })

    it('shows the just-saved set as saved, then defers to a new held set', async () => {
      const { props, rerenderWith } = renderDrawer('u-emma')
      await userEvent.click(screen.getByRole('checkbox', { name: /Finance/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() =>
        expect(screen.getByTestId('drawer-footer')).toHaveTextContent('No changes')
      )
      expect(screen.getByRole('heading', { name: /Emma's roles\s*3/ })).toBeInTheDocument()

      const byId = (id: string) => props.data.roleLikes.find((r) => r.id === id)!
      const held = new Map(props.data.held)
      held.set('u-emma', [byId('r-exec'), byId('r-bunk'), byId('r-fin'), byId('r-empty')])
      rerenderWith('u-emma', { ...props.data, held })
      expect(screen.getByRole('heading', { name: /Emma's roles\s*4/ })).toBeInTheDocument()
    })

    it('resets the draft when the drawer switches person', async () => {
      const { rerenderWith } = renderDrawer('u-emma')
      await userEvent.click(screen.getByRole('checkbox', { name: /Finance/ }))
      expect(screen.getByTestId('drawer-footer')).toHaveTextContent('1 change')
      rerenderWith('u-liam')
      expect(screen.getByRole('heading', { name: /Liam's roles/ })).toBeInTheDocument()
      expect(screen.getByTestId('drawer-footer')).toHaveTextContent('No changes')
    })
  })

  describe('fact line (R11)', () => {
    it('shows the Pocket ID sign-in date when last_login is set', () => {
      renderDrawer('u-emma')
      expect(screen.getByTestId('drawer-facts')).toHaveTextContent(
        'signed in via Pocket ID May 3, 2026'
      )
    })

    it('omits the sign-in part and says "Never active" when neither is set', () => {
      renderDrawer('u-olivia')
      const facts = screen.getByTestId('drawer-facts')
      expect(facts).toHaveTextContent('Never active')
      expect(facts).not.toHaveTextContent('Pocket ID')
    })
  })

  describe('admin-only lock line (R12)', () => {
    it('is derived from the registry, trimmed at the first " ("', () => {
      renderDrawer('u-emma')
      expect(screen.getByTestId('can-do')).toHaveTextContent(
        'Admin-only areas stay locked: Manage › Sync, Manage › Config, Manage › Audit log, Creating and editing roles.'
      )
    })

    it('is omitted, without crashing, while the registry is not loaded', () => {
      renderDrawer('u-emma', { noRegistry: true })
      expect(screen.getByTestId('can-do')).not.toHaveTextContent('Admin-only areas')
      expect(screen.getByTestId('role-row-r-bunk')).toBeInTheDocument()
    })
  })
})
