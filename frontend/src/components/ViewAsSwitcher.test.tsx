import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement, useState } from 'react'
import { AuthContext } from '../contexts/AuthContext'
import { createMockAuthContext, createMockUser } from '../test/test-helpers'
import { readViewAs, writeViewAs } from '../auth/viewAs'

const defaultRoles = [
  { id: 'r1', name: 'Bunking Staff', slug: 'bunking-staff', permissions: ['bunking.manage'] },
  {
    id: 'r2',
    name: 'Registrar',
    slug: 'registrar',
    permissions: ['registration.manage', 'metrics.geo'],
  },
]
let mockRolesQuery: {
  data: typeof defaultRoles | undefined
  isLoading: boolean
  error: Error | null
} = {
  data: defaultRoles,
  isLoading: false,
  error: null,
}
vi.mock('../hooks/useRoles', () => ({
  useRoles: () => mockRolesQuery,
}))

import { ViewAsSwitcher } from './ViewAsSwitcher'
import { useCanViewAs } from '../hooks/useCanViewAs'

const reload = vi.fn()

beforeEach(() => {
  mockRolesQuery = { data: defaultRoles, isLoading: false, error: null }
  window.sessionStorage.clear()
  reload.mockClear()
  Object.defineProperty(window, 'location', {
    value: { reload },
    writable: true,
    configurable: true,
  })
})

// Owner ruling 2026-10-01: the bar no longer carries a "View as" button while
// not previewing; the menu is opened from the user menu in AppLayout. This
// harness plays AppLayout: an "Open View as" entry point drives the controlled
// `open` prop, and shows whether the entry would be offered (useCanViewAs).
function Harness() {
  const [open, setOpen] = useState(false)
  const canViewAs = useCanViewAs()
  return createElement(
    'div',
    null,
    canViewAs && createElement('button', { onClick: () => setOpen(true) }, 'Open View as'),
    createElement(ViewAsSwitcher, { open, onOpenChange: setOpen })
  )
}

function renderAs({ isAdmin, isBypassMode = false }: { isAdmin: boolean; isBypassMode?: boolean }) {
  const ctx = createMockAuthContext({ user: createMockUser({ is_admin: isAdmin }), isBypassMode })
  return render(createElement(AuthContext.Provider, { value: ctx }, createElement(Harness)))
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Open View as' }))

describe('ViewAsSwitcher', () => {
  it('is hidden for a real non-admin: no pill, no entry point', () => {
    renderAs({ isAdmin: false })
    expect(screen.queryByRole('button', { name: /view as/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Exit preview' })).toBeNull()
  })

  it('is hidden in bypass mode', () => {
    renderAs({ isAdmin: true, isBypassMode: true })
    expect(screen.queryByRole('button', { name: /view as/i })).toBeNull()
  })

  it('a real admin not previewing has no View as button in the bar, only the entry point', () => {
    renderAs({ isAdmin: true })
    expect(screen.getByRole('button', { name: 'Open View as' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^view as$/i })).toBeNull()
    expect(screen.queryByTestId('view-as-menu')).toBeNull()
  })

  it('the controlled open prop shows the menu and reports closing on Escape', () => {
    renderAs({ isAdmin: true })
    openMenu()
    expect(screen.getByTestId('view-as-menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('view-as-menu')).toBeNull()
  })

  // Owner ruling 2026-10-01 (supersedes the amber pill in the nav bar): while
  // previewing, an amber strip above the nav carries the state, a Switch button
  // that opens the menu, and Exit preview.
  it('previewing: the strip shows the persona, Switch opens the menu', () => {
    writeViewAs({ label: 'Registrar', source: 'role', permissions: ['metrics.geo'] })
    renderAs({ isAdmin: true })
    const strip = screen.getByTestId('view-as-strip')
    expect(strip).toHaveTextContent('Viewing as Registrar')
    expect(screen.queryByTestId('view-as-menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Switch/ }))
    expect(screen.getByTestId('view-as-menu')).toBeTruthy()
  })

  it('not previewing: no strip', () => {
    renderAs({ isAdmin: true })
    expect(screen.queryByTestId('view-as-strip')).toBeNull()
  })

  it('a non-admin gets no strip', () => {
    renderAs({ isAdmin: false })
    expect(screen.queryByTestId('view-as-strip')).toBeNull()
  })

  it('an admin previewing as a non-admin role still gets the strip and the entry point', () => {
    writeViewAs({ label: 'No role', source: 'none', permissions: [] })
    renderAs({ isAdmin: true })
    expect(screen.getByTestId('view-as-strip')).toHaveTextContent('Viewing as No role')
    expect(screen.getByRole('button', { name: /Exit preview/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open View as' })).toBeTruthy()
  })

  it('picking a role stores its permission snapshot and reloads', () => {
    renderAs({ isAdmin: true })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    expect(readViewAs()).toEqual({
      label: 'Registrar',
      source: 'role',
      roleId: 'r2',
      permissions: ['metrics.geo', 'registration.manage'],
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('checks the previewed role by id, so a rename mid-preview keeps the checkmark', () => {
    writeViewAs({
      label: 'Old Registrar Name',
      source: 'role',
      roleId: 'r2',
      permissions: ['metrics.geo'],
    })
    renderAs({ isAdmin: true })
    fireEvent.click(screen.getByRole('button', { name: /Switch/ }))
    const registrarItem = screen.getByRole('button', { name: /^Registrar/ })
    const bunkingItem = screen.getByRole('button', { name: /^Bunking Staff/ })
    expect(registrarItem.querySelector('svg')).not.toBeNull()
    expect(bunkingItem.querySelector('svg')).toBeNull()
  })

  it('collapses an un-applied Custom section when the menu closes', () => {
    renderAs({ isAdmin: true })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    expect(screen.getByLabelText('sheets.export')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    openMenu()
    expect(screen.queryByLabelText('sheets.export')).toBeNull()
  })

  it('picking No role stores an empty persona', () => {
    renderAs({ isAdmin: true })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /No role/ }))
    expect(readViewAs()).toEqual({ label: 'No role', source: 'none', permissions: [] })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('stays visible while previewing and shows the persona', () => {
    writeViewAs({ label: 'Registrar', source: 'role', permissions: ['metrics.geo'] })
    renderAs({ isAdmin: true })
    expect(screen.getByTestId('view-as-strip')).toHaveTextContent('Registrar')
    expect(screen.getByRole('button', { name: /Exit preview/ })).toBeTruthy()
  })

  it('the exit button clears the persona in one click and reloads', () => {
    writeViewAs({ label: 'Registrar', source: 'role', permissions: ['metrics.geo'] })
    renderAs({ isAdmin: true })
    fireEvent.click(screen.getByRole('button', { name: /Exit preview/ }))
    expect(readViewAs()).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('custom: ticking a box does not switch; Apply does', () => {
    renderAs({ isAdmin: true })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    fireEvent.click(screen.getByLabelText('sheets.export'))
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(readViewAs()).toEqual({
      label: 'Custom',
      source: 'custom',
      permissions: ['sheets.export'],
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('custom: Apply with nothing ticked is a working empty persona labelled Custom (0)', () => {
    renderAs({ isAdmin: true })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(readViewAs()).toEqual({ label: 'Custom', source: 'custom', permissions: [] })
  })

  it('labels a custom persona with its permission count', () => {
    writeViewAs({ label: 'Custom', source: 'custom', permissions: [] })
    renderAs({ isAdmin: true })
    expect(screen.getByTestId('view-as-strip')).toHaveTextContent('Custom (0)')
  })

  it('says roles are loading instead of looking empty, and keeps No role usable', () => {
    mockRolesQuery = { data: undefined, isLoading: true, error: null }
    renderAs({ isAdmin: true })
    openMenu()
    expect(screen.getByText('Loading roles…')).toBeTruthy()
    expect(screen.getByRole('button', { name: /No role/ })).toBeTruthy()
  })

  it('says roles could not load instead of looking empty, and keeps Custom usable', () => {
    mockRolesQuery = { data: undefined, isLoading: false, error: new Error('boom') }
    renderAs({ isAdmin: true })
    openMenu()
    expect(screen.getByText("Couldn't load roles")).toBeTruthy()
    expect(screen.getByRole('button', { name: /Custom/ })).toBeTruthy()
  })

  it('keeps each role to one line, with its permissions on hover', () => {
    renderAs({ isAdmin: true })
    openMenu()
    const registrar = screen.getByRole('button', { name: /^Registrar/ })
    expect(registrar.getAttribute('title')).toBe('registration.manage · metrics.geo')
    expect(screen.queryByText('registration.manage · metrics.geo')).toBeNull()
  })

  it('scrolls only the role list, so No role and Custom stay reachable in a short window', () => {
    renderAs({ isAdmin: true })
    openMenu()
    const roleList = screen.getByTestId('view-as-roles')
    expect(roleList.className).toContain('overflow-y-auto')
    expect(roleList.contains(screen.getByRole('button', { name: /^Registrar/ }))).toBe(true)
    expect(roleList.contains(screen.getByRole('button', { name: /No role/ }))).toBe(false)
    expect(roleList.contains(screen.getByRole('button', { name: /Custom/ }))).toBe(false)
    const menu = roleList.closest('[data-testid="view-as-menu"]')
    expect(menu?.className).toContain('max-h-[calc(100vh-5rem)]')
  })

  it("sets its own text colour, so nothing inherits the header nav's white", () => {
    renderAs({ isAdmin: true })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    expect(screen.getByTestId('view-as-menu').className).toContain('text-foreground')
    expect(screen.getByLabelText('sheets.export').className).toContain('accent-primary')
  })

  it('custom: ticking a permission family selects all of it, and Apply stores them', () => {
    renderAs({ isAdmin: true })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    fireEvent.click(screen.getByLabelText('financial_aid'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(readViewAs()).toEqual({
      label: 'Custom',
      source: 'custom',
      permissions: [
        'financial_aid.casework',
        'financial_aid.grantors',
        'financial_aid.rules',
        'financial_aid.summary',
        'financial_aid.view',
      ],
    })
  })

  it('picking a role tells the audit log a preview started, as the real admin', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    renderAs({ isAdmin: true })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/custom/view-as/start')
    expect(new Headers(init.headers).get('X-Kindred-View-As')).toBeNull()
    expect(JSON.parse(String(init.body))).toMatchObject({ persona: 'Registrar' })
    fetchSpy.mockRestore()
  })

  it('closes on Escape', () => {
    renderAs({ isAdmin: true })
    openMenu()
    expect(screen.getByRole('button', { name: /No role/ })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /No role/ })).toBeNull()
  })
})
