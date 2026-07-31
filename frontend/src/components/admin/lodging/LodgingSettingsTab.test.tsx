/** The lodging settings host: three sections, driven by the route param. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { ADMIN_TABS } from '../../../config/adminTabs'
import { LodgingSettingsTab } from './LodgingSettingsTab'

vi.mock('./LodgingUnitsPanel', () => ({ LodgingUnitsPanel: () => <div>UNITS PANEL</div> }))
vi.mock('./LodgingAliasesPanel', () => ({ LodgingAliasesPanel: () => <div>ALIASES PANEL</div> }))
vi.mock('./UnresolvedAliasQueue', () => ({ UnresolvedAliasQueue: () => <div>QUEUE PANEL</div> }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/lodging/:section" element={<LodgingSettingsTab />} />
        <Route path="/admin/lodging" element={<LodgingSettingsTab />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ADMIN_TABS', () => {
  it('registers the Family Camp Lodging tab as admin-only', () => {
    const tab = ADMIN_TABS.find((t) => t.id === 'lodging')
    expect(tab).toBeDefined()
    expect(tab?.path).toBe('/admin/lodging')
    expect(tab?.requiredPermission).toBe('admin')
  })
})

describe('LodgingSettingsTab', () => {
  it('defaults to the units section', () => {
    renderAt('/admin/lodging')
    expect(screen.getByText('UNITS PANEL')).toBeInTheDocument()
  })

  it('renders the aliases section', () => {
    renderAt('/admin/lodging/aliases')
    expect(screen.getByText('ALIASES PANEL')).toBeInTheDocument()
  })

  it('renders the unresolved work queue', () => {
    renderAt('/admin/lodging/unresolved')
    expect(screen.getByText('QUEUE PANEL')).toBeInTheDocument()
  })

  it('falls back to units for an unknown section rather than rendering nothing', () => {
    renderAt('/admin/lodging/nonsense')
    expect(screen.getByText('UNITS PANEL')).toBeInTheDocument()
  })

  it('links to all three sections', () => {
    renderAt('/admin/lodging/units')
    expect(screen.getByRole('link', { name: 'Units' })).toHaveAttribute(
      'href',
      '/admin/lodging/units'
    )
    expect(screen.getByRole('link', { name: 'Cabin name aliases' })).toHaveAttribute(
      'href',
      '/admin/lodging/aliases'
    )
    expect(screen.getByRole('link', { name: 'Unresolved names' })).toHaveAttribute(
      'href',
      '/admin/lodging/unresolved'
    )
  })
})
