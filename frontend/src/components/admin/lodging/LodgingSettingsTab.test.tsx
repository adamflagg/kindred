/** The lodging settings host: three sections, driven by the route param. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { ADMIN_TABS } from '../../../config/adminTabs'
import { MANAGE_TABS } from '../../../config/manageTabs'
import { Permission } from '../../../constants/permissions'
import { LodgingSettingsTab } from './LodgingSettingsTab'

vi.mock('./LodgingUnitsPanel', () => ({ LodgingUnitsPanel: () => <div>UNITS PANEL</div> }))
vi.mock('./LodgingAliasesPanel', () => ({ LodgingAliasesPanel: () => <div>ALIASES PANEL</div> }))
vi.mock('./UnresolvedAliasQueue', () => ({ UnresolvedAliasQueue: () => <div>QUEUE PANEL</div> }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/manage/lodging/:section" element={<LodgingSettingsTab />} />
        <Route path="/manage/lodging" element={<LodgingSettingsTab />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('lodging tab registration', () => {
  it('lives under Manage, gated on bunking.manage', () => {
    // Confirming cabins is bunking staff's job, not an administrator's. The
    // tab moved off /admin so the people who hold bunking.manage can reach it
    // without being granted admin — which would hand them sync and config too.
    const tab = MANAGE_TABS.find((t) => t.id === 'lodging')
    expect(tab).toBeDefined()
    expect(tab?.path).toBe('/manage/lodging')
    expect(tab?.requiredPermission).toBe(Permission.BUNKING_MANAGE)
  })

  it('no longer appears under Admin', () => {
    expect(ADMIN_TABS.some((t) => t.path.startsWith('/admin/lodging'))).toBe(false)
  })
})

describe('LodgingSettingsTab', () => {
  it('defaults to the units section', () => {
    renderAt('/manage/lodging')
    expect(screen.getByText('UNITS PANEL')).toBeInTheDocument()
  })

  it('renders the aliases section', () => {
    renderAt('/manage/lodging/aliases')
    expect(screen.getByText('ALIASES PANEL')).toBeInTheDocument()
  })

  it('renders the unresolved work queue', () => {
    renderAt('/manage/lodging/unresolved')
    expect(screen.getByText('QUEUE PANEL')).toBeInTheDocument()
  })

  it('falls back to units for an unknown section rather than rendering nothing', () => {
    renderAt('/manage/lodging/nonsense')
    expect(screen.getByText('UNITS PANEL')).toBeInTheDocument()
  })

  it('links to all three sections', () => {
    renderAt('/manage/lodging/units')
    expect(screen.getByRole('link', { name: 'Units' })).toHaveAttribute(
      'href',
      '/manage/lodging/units'
    )
    expect(screen.getByRole('link', { name: 'Cabin name aliases' })).toHaveAttribute(
      'href',
      '/manage/lodging/aliases'
    )
    expect(screen.getByRole('link', { name: 'Unresolved names' })).toHaveAttribute(
      'href',
      '/manage/lodging/unresolved'
    )
  })
})
