import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
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

function renderAs({ isAdmin, isBypassMode = false }: { isAdmin: boolean; isBypassMode?: boolean }) {
  const ctx = createMockAuthContext({ user: createMockUser({ is_admin: isAdmin }), isBypassMode })
  return render(createElement(AuthContext.Provider, { value: ctx }, createElement(ViewAsSwitcher)))
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /view as/i }))

describe('ViewAsSwitcher', () => {
  it('is hidden for a real non-admin', () => {
    renderAs({ isAdmin: false })
    expect(screen.queryByRole('button', { name: /view as/i })).toBeNull()
  })

  it('is hidden in bypass mode', () => {
    renderAs({ isAdmin: true, isBypassMode: true })
    expect(screen.queryByRole('button', { name: /view as/i })).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: /Old Registrar Name/ }))
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
    expect(screen.getByRole('button', { name: /Registrar/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Exit preview' })).toBeTruthy()
  })

  it('the exit button clears the persona in one click and reloads', () => {
    writeViewAs({ label: 'Registrar', source: 'role', permissions: ['metrics.geo'] })
    renderAs({ isAdmin: true })
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }))
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
    expect(screen.getByRole('button', { name: /Custom \(0\)/ })).toBeTruthy()
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

  it('closes on Escape', () => {
    renderAs({ isAdmin: true })
    openMenu()
    expect(screen.getByRole('button', { name: /No role/ })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /No role/ })).toBeNull()
  })
})
