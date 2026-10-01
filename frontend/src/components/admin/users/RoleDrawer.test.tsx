import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { makeProps } from './testFixtures'
import { queryKeys } from '../../../utils/queryKeys'

let mockIsAdmin = true
let mockOverrides: Array<Record<string, string>> | undefined = undefined
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: vi.fn(),
    hasAnyPermission: vi.fn(),
    isAdmin: mockIsAdmin,
    permissions: [],
  }),
}))
vi.mock('../../../hooks/usePermissionDescriptions', () => ({
  usePermissionDescriptions: () => ({ data: mockOverrides }),
}))
vi.mock('../../../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      delete: (...a: unknown[]) => remove(...a),
    }),
  },
}))

const { RoleDrawer } = await import('./RoleDrawer')

type Props = ReturnType<typeof makeProps>

function renderRoleDrawer(
  roleId: string | null,
  opts: { noRegistry?: boolean; mutate?: (p: Props) => void } = {}
) {
  const props = makeProps()
  opts.mutate?.(props)
  const registry = opts.noRegistry
    ? ({ data: undefined, isLoading: true, error: null } as unknown as Props['registry'])
    : props.registry
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const onClose = vi.fn()
  const onCreated = vi.fn()
  const setRole = props.url.setRole as ReturnType<typeof vi.fn>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RoleDrawer
          roleId={roleId}
          data={props.data}
          registry={registry}
          url={props.url}
          onClose={onClose}
          onCreated={onCreated}
        />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { invalidate, onClose, onCreated, setRole }
}

beforeEach(() => {
  mockIsAdmin = true
  mockOverrides = undefined
  create.mockReset().mockResolvedValue({ id: 'r-new' })
  update.mockReset().mockResolvedValue({})
  remove.mockReset().mockResolvedValue(true)
})

describe('RoleDrawer', () => {
  it('view mode shows description, holders and permissions by area; Edit only for admins', () => {
    mockIsAdmin = false
    renderRoleDrawer('r-exec')
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Executive access')).toBeInTheDocument()
    expect(screen.getByText('Geographic data')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manage › Geo Data/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit role' })).not.toBeInTheDocument()
  })

  it('shows the holders in Users on request', async () => {
    const { setRole } = renderRoleDrawer('r-exec')
    await userEvent.click(screen.getByRole('button', { name: /Show in Users/ }))
    expect(setRole).toHaveBeenCalledWith('r-exec')
  })

  it('does not open the editor for a non-admin, even when creating', () => {
    mockIsAdmin = false
    renderRoleDrawer(null)
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('keeps the sticky footer opaque while editing (the tint must not be the background)', async () => {
    renderRoleDrawer('r-exec')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Google Sheets export/ }))
    const footer = screen.getByTestId('role-footer')
    expect(footer.className).toContain('bg-card')
    expect(footer.className).not.toContain('bg-primary/5')
  })

  it('editing shows live impact in the footer (R4b)', async () => {
    renderRoleDrawer('r-exec')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Bunking and housing/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Google Sheets export/ }))
    const footer = screen.getByTestId('role-footer')
    expect(footer).toHaveTextContent('2 changes: + Google Sheets export · − Bunking and housing')
    expect(footer).toHaveTextContent(
      'Bunking and housing: nobody loses it; Emma Johnson keeps it through another role'
    )
    expect(footer).toHaveTextContent('Google Sheets export: Emma Johnson gains it')
    expect(update).not.toHaveBeenCalled()
  })

  it('saves the edited permissions in registry order and invalidates roles', async () => {
    const { invalidate } = renderRoleDrawer('r-exec')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Google Sheets export/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(update).toHaveBeenCalledWith(
      'r-exec',
      expect.objectContaining({
        permissions: ['bunking.manage', 'metrics.geo', 'sheets.export', 'users.manage'],
      })
    )
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.roles() }))
  })

  it('uses description overrides from the hook (R4)', async () => {
    mockOverrides = [
      {
        id: 'o1',
        codename: 'metrics.geo',
        description: 'Staff-worded geo text.',
        base_description: 'See and edit the geographic data behind the maps.',
      },
    ]
    renderRoleDrawer('r-exec')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    expect(screen.getByText('Staff-worded geo text.')).toBeInTheDocument()
    expect(screen.getByText("Give and remove other staff's roles.")).toBeInTheDocument()
  })

  it('locks a system role slug and offers no delete', async () => {
    renderRoleDrawer('r-bunk')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    expect(screen.getByLabelText('Slug')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Delete this role/ })).not.toBeInTheDocument()
    expect(screen.getByText(/System roles can be edited but not deleted/)).toBeInTheDocument()
  })

  it('asks before deleting a non-system role, inside the drawer', async () => {
    const { invalidate, onClose } = renderRoleDrawer('r-fin')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    await userEvent.click(screen.getByRole('button', { name: /Delete this role/ }))
    expect(screen.getByText(/Delete Finance\?/)).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    expect(remove).toHaveBeenCalledWith('r-fin')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.roles() })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.userRoles() })
  })

  it('"Keep it" backs out of a delete', async () => {
    renderRoleDrawer('r-fin')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    await userEvent.click(screen.getByRole('button', { name: /Delete this role/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByRole('button', { name: /Delete this role/ })).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
  })

  it('new role derives the slug from the name until edited, then creates', async () => {
    const { onCreated } = renderRoleDrawer(null)
    expect(screen.getByRole('button', { name: 'Create role' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Name'), 'Office Staff')
    expect(screen.getByLabelText('Slug')).toHaveValue('office-staff')
    expect(screen.getByRole('button', { name: 'Create role' })).toBeEnabled()
    await userEvent.type(screen.getByLabelText('Slug'), 'x')
    await userEvent.type(screen.getByLabelText('Name'), 's')
    expect(screen.getByLabelText('Slug')).toHaveValue('office-staffx')
    await userEvent.click(screen.getByRole('checkbox', { name: /Google Sheets export/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Office Staffs',
        slug: 'office-staffx',
        permissions: ['sheets.export'],
        is_system: false,
      })
    )
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith('r-new'))
  })

  it('keeps the editor and says so when a save fails', async () => {
    update.mockRejectedValue(new Error('Server said no'))
    renderRoleDrawer('r-exec')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Google Sheets export/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/Couldn't save: Server said no/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Google Sheets export/ })).toBeChecked()
  })

  it('keeps the delete box and says so when a delete fails', async () => {
    remove.mockRejectedValue(new Error('Still in use'))
    const { onClose } = renderRoleDrawer('r-fin')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    await userEvent.click(screen.getByRole('button', { name: /Delete this role/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    expect(await screen.findByText(/Couldn't delete: Still in use/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(/Delete Finance\?/)).toBeInTheDocument()
  })

  it('renders with an unresolved registry: bare codenames, role order kept', async () => {
    renderRoleDrawer('r-exec', { noRegistry: true })
    expect(screen.getByText('metrics.geo')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /metrics\.geo/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /metrics\.geo/ }))
    await userEvent.type(screen.getByLabelText('Description'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(update).toHaveBeenCalledWith(
      'r-exec',
      expect.objectContaining({ permissions: ['bunking.manage', 'metrics.geo', 'users.manage'] })
    )
  })

  it('counts only permissions the registry knows, so n never exceeds the total', async () => {
    renderRoleDrawer('r-exec', {
      mutate: (p) => {
        p.data.roles.find((r) => r.id === 'r-exec')!.permissions.push('legacy.gone')
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    expect(screen.getByText('3 of 7')).toBeInTheDocument()
  })

  it('names three people and then "and N more" in an impact line', async () => {
    renderRoleDrawer('r-exec', {
      mutate: (p) => {
        const exec = p.data.roleLikes.find((r) => r.id === 'r-exec')!
        for (const id of ['u-p1', 'u-p2', 'u-p3', 'u-p4']) p.data.held.set(id, [exec])
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Geographic data/ }))
    expect(screen.getByTestId('role-footer')).toHaveTextContent(
      'Geographic data: Emma Johnson, Person 01, Person 02 and 2 more lose it'
    )
  })

  it('tints the footer on an inner layer, only while the edit is valid', async () => {
    renderRoleDrawer('r-exec')
    await userEvent.click(screen.getByRole('button', { name: 'Edit role' }))
    const footer = screen.getByTestId('role-footer')
    const layer = footer.firstElementChild as HTMLElement
    expect(layer.className).not.toContain('bg-primary/5')
    await userEvent.click(screen.getByRole('checkbox', { name: /Google Sheets export/ }))
    expect(layer.className).toContain('bg-primary/5')
    expect(footer.className).toContain('bg-card')
  })
})
