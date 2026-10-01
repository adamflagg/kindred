import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { makeProps, REGISTRY } from './testFixtures'
import type { UsersPageProps } from './types'

let mockIsAdmin = true
let mockOverrides: Array<{
  id: string
  codename: string
  description: string
  base_description: string
}> = []
let mockOverridesError = false
let mockPending = false
const mutate = vi.fn()

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: vi.fn(),
    hasAnyPermission: vi.fn(),
    isAdmin: mockIsAdmin,
    permissions: [],
  }),
}))
vi.mock('../../../hooks/usePermissionDescriptions', () => ({
  usePermissionDescriptions: () => ({
    data: mockOverridesError ? undefined : mockOverrides,
    isError: mockOverridesError,
  }),
  useSaveDescription: () => ({ mutate, isPending: mockPending }),
}))

const { PermissionsTab } = await import('./PermissionsTab')

function renderPerms(
  url: Partial<UsersPageProps['url']> = {},
  overrides: typeof mockOverrides = [],
  tweak?: (p: ReturnType<typeof makeProps>) => void
) {
  mockOverrides = overrides
  const props = makeProps(url)
  tweak?.(props)
  render(
    <MemoryRouter>
      <PermissionsTab {...props} />
    </MemoryRouter>
  )
  return props
}

beforeEach(() => {
  mockIsAdmin = true
  mockOverrides = []
  mockOverridesError = false
  mockPending = false
  mutate.mockReset()
})

describe('PermissionsTab', () => {
  it('renders the admin strip, a header row and one card per area', () => {
    renderPerms()
    expect(screen.getByTestId('permissions-tab')).toHaveTextContent('Admins can do everything')
    expect(screen.getAllByTestId(/^perm-area-/).map((a) => a.dataset['testid'])).toEqual([
      'perm-area-Summer and Weekend',
      'perm-area-Camperships',
      'perm-area-Analytics',
      'perm-area-Manage tools',
      'perm-area-People',
    ])
  })

  it('R13: the strip lists every admin-only entry in full', () => {
    renderPerms()
    const text = screen.getByTestId('permissions-tab').textContent
    expect(text).toContain(
      'Admins can do everything, plus these, which no permission grants: ' +
        REGISTRY.admin_only.join(', ') +
        '.'
    )
    expect(text).not.toMatch(/four things/)
  })

  it('R13: keeps parenthetical caveats', () => {
    renderPerms({}, [], (p) => {
      ;(p.registry as { data: typeof REGISTRY }).data = {
        ...REGISTRY,
        admin_only: [
          ...REGISTRY.admin_only,
          'Manage › Data (bunking staff can still refresh data)',
        ],
      }
    })
    expect(screen.getByTestId('permissions-tab')).toHaveTextContent(
      'Manage › Data (bunking staff can still refresh data).'
    )
  })

  it('shows description, a ruled "Find it in" subsection with links, roles and people (M3, M5)', () => {
    renderPerms()
    const row = screen.getByTestId('perm-metrics.geo')
    expect(within(row).getByRole('link', { name: /Manage › Geo Data/ })).toHaveAttribute(
      'href',
      '/manage/geo'
    )
    expect(row).toHaveTextContent('Find it in')
    expect(
      within(screen.getByTestId('perm-metrics.financial')).getByText('No screen yet')
    ).toBeInTheDocument()
    expect(screen.getByTestId('perm-metrics.financial')).toHaveTextContent('Not checked anywhere')
    expect(screen.getByTestId('perm-bunking.manage')).toHaveTextContent('2 people')
  })

  it('role chips open the Roles tab', async () => {
    const props = renderPerms()
    await userEvent.click(
      within(screen.getByTestId('perm-bunking.manage')).getByRole('button', { name: 'Executive' })
    )
    expect(props.url.setTab).toHaveBeenCalledWith('roles')
  })

  it('scrolls inside its own box with sticky area headings (M2)', () => {
    renderPerms()
    expect(screen.getByTestId('perm-scroll').className).toMatch(/overflow-y-auto/)
    expect(screen.getByText('Analytics', { selector: 'h3' }).className).toMatch(/sticky/)
  })

  it('measures maxHeight and re-measures on resize, removing the listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    mockOverrides = []
    const props = makeProps()
    const { unmount } = render(
      <MemoryRouter>
        <PermissionsTab {...props} />
      </MemoryRouter>
    )
    const box = screen.getByTestId('perm-scroll')
    expect(box.style.maxHeight).toBe(`${Math.max(240, window.innerHeight - 24)}px`)
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true })
    fireEvent(window, new Event('resize'))
    expect(box.style.maxHeight).toBe('476px')
    expect(add).toHaveBeenCalledWith('resize', expect.any(Function))
    unmount()
    const handler = add.mock.calls.find((c) => c[0] === 'resize')?.[1]
    expect(remove).toHaveBeenCalledWith('resize', handler)
    add.mockRestore()
    remove.mockRestore()
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
  })

  it('admins edit in place; blank resets to default (M6, Review Focus 2)', async () => {
    mockIsAdmin = true
    renderPerms({}, [
      { id: 'o1', codename: 'metrics.geo', description: 'Edited.', base_description: 'Older.' },
    ])
    const row = screen.getByTestId('perm-metrics.geo')
    expect(row).toHaveTextContent('Edited')
    expect(row).toHaveTextContent('Default changed')
    await userEvent.click(within(row).getByRole('button', { name: 'Edit description' }))
    const box = within(row).getByRole('textbox')
    await userEvent.clear(box)
    await userEvent.type(box, '   ')
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(mutate).toHaveBeenCalledWith({ kind: 'delete', id: 'o1' }, expect.anything())
  })

  it('saving an unchanged default with no override skips the write but closes the editor', async () => {
    renderPerms()
    const row = screen.getByTestId('perm-metrics.geo')
    await userEvent.click(within(row).getByRole('button', { name: 'Edit description' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(mutate).not.toHaveBeenCalled()
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('a successful save closes the editor', async () => {
    mutate.mockImplementation((_w, opts) => opts.onSuccess())
    renderPerms()
    const row = screen.getByTestId('perm-metrics.geo')
    await userEvent.click(within(row).getByRole('button', { name: 'Edit description' }))
    const box = within(row).getByRole('textbox')
    await userEvent.clear(box)
    await userEvent.type(box, 'Plain words.')
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'create', codename: 'metrics.geo' }),
      expect.anything()
    )
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('a failed save keeps the editor open with its text and shows an error', async () => {
    mutate.mockImplementation((_w, opts) => opts.onError(new Error('rule refused')))
    renderPerms()
    const row = screen.getByTestId('perm-metrics.geo')
    await userEvent.click(within(row).getByRole('button', { name: 'Edit description' }))
    const box = within(row).getByRole('textbox')
    await userEvent.clear(box)
    await userEvent.type(box, 'Plain words.')
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(within(row).getByRole('textbox')).toHaveValue('Plain words.')
    expect(row).toHaveTextContent("Couldn't save: rule refused")
  })

  it('a failed reset shows an error on that row and clears on the next attempt', async () => {
    mutate.mockImplementation((_w, opts) => opts.onError(new Error('rule refused')))
    renderPerms({}, [
      { id: 'o1', codename: 'metrics.geo', description: 'Edited.', base_description: 'x' },
    ])
    const row = screen.getByTestId('perm-metrics.geo')
    await userEvent.click(within(row).getByRole('button', { name: 'Reset to default' }))
    expect(row).toHaveTextContent("Couldn't reset: rule refused.")
    expect(screen.getByTestId('perm-bunking.manage')).not.toHaveTextContent("Couldn't")
    mutate.mockImplementation(() => {})
    await userEvent.click(within(row).getByRole('button', { name: 'Reset to default' }))
    expect(row).not.toHaveTextContent("Couldn't reset")
  })

  it('opening the editor clears a row error', async () => {
    mutate.mockImplementation((_w, opts) => opts.onError(new Error('boom')))
    renderPerms({}, [
      { id: 'o1', codename: 'metrics.geo', description: 'Edited.', base_description: 'x' },
    ])
    const row = screen.getByTestId('perm-metrics.geo')
    await userEvent.click(within(row).getByRole('button', { name: 'Reset to default' }))
    expect(row).toHaveTextContent("Couldn't reset: boom.")
    await userEvent.click(within(row).getByRole('button', { name: 'Edit description' }))
    expect(row).not.toHaveTextContent("Couldn't reset")
  })

  it('reset is disabled while a save is pending', () => {
    mockPending = true
    renderPerms({}, [
      { id: 'o1', codename: 'metrics.geo', description: 'Edited.', base_description: 'x' },
    ])
    expect(
      within(screen.getByTestId('perm-metrics.geo')).getByRole('button', {
        name: 'Reset to default',
      })
    ).toBeDisabled()
  })

  it('reset icon removes an override', async () => {
    mockIsAdmin = true
    renderPerms({}, [
      {
        id: 'o1',
        codename: 'metrics.geo',
        description: 'Edited.',
        base_description: 'See and edit the geographic data behind the maps.',
      },
    ])
    await userEvent.click(
      within(screen.getByTestId('perm-metrics.geo')).getByRole('button', {
        name: 'Reset to default',
      })
    )
    expect(mutate).toHaveBeenCalledWith({ kind: 'delete', id: 'o1' }, expect.anything())
  })

  it('non-admins see only the text (M7)', () => {
    mockIsAdmin = false
    renderPerms({}, [
      { id: 'o1', codename: 'metrics.geo', description: 'Edited.', base_description: 'Older.' },
    ])
    const row = screen.getByTestId('perm-metrics.geo')
    expect(row).toHaveTextContent('Edited.')
    expect(within(row).queryByRole('button', { name: 'Edit description' })).not.toBeInTheDocument()
    expect(row).not.toHaveTextContent('Default changed')
  })

  it('overrides query failed: defaults shown, no admin controls even for admins (§6)', () => {
    mockIsAdmin = true
    mockOverridesError = true
    renderPerms()
    const row = screen.getByTestId('perm-metrics.geo')
    expect(row).toHaveTextContent('See and edit the geographic data behind the maps.')
    expect(screen.queryByRole('button', { name: 'Edit description' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument()
  })

  it('registry loading: shows the guard, not the tab (§6)', () => {
    renderPerms({}, [], (p) => {
      p.registry = { data: undefined, isLoading: true, error: null } as unknown as typeof p.registry
    })
    expect(screen.getByText(/Loading permissions data/)).toBeInTheDocument()
    expect(screen.queryByTestId('permissions-tab')).not.toBeInTheDocument()
  })

  it('registry failed: shows the guard error (§6)', () => {
    renderPerms({}, [], (p) => {
      p.registry = {
        data: undefined,
        isLoading: false,
        error: new Error('nope'),
      } as unknown as typeof p.registry
    })
    expect(screen.getByText(/Failed to load permissions data: nope/)).toBeInTheDocument()
    expect(screen.queryByTestId('permissions-tab')).not.toBeInTheDocument()
  })

  it('highlights and scrolls to the focused permission without writing the URL (R5, R10)', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const props = renderPerms({ focus: 'metrics.geo' })
    expect(screen.getByTestId('perm-metrics.geo').className).toMatch(/ring|shadow-\[inset/)
    expect(scrollIntoView).toHaveBeenCalled()
    expect(props.url.setTab).not.toHaveBeenCalled()
  })
})
