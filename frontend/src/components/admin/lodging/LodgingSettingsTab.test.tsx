/** The lodging settings host: three sections, driven by the route param. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { MANAGE_TABS } from '../../../config/manageTabs'
import { Permission } from '../../../constants/permissions'
import { LodgingSettingsTab } from './LodgingSettingsTab'

vi.mock('./LodgingUnitsPanel', () => ({ LodgingUnitsPanel: () => <div>UNITS PANEL</div> }))
vi.mock('./LodgingAliasesPanel', () => ({ LodgingAliasesPanel: () => <div>ALIASES PANEL</div> }))
vi.mock('./UnresolvedAliasQueue', () => ({ UnresolvedAliasQueue: () => <div>QUEUE PANEL</div> }))
vi.mock('./MergeRepairPanel', () => ({ MergeRepairPanel: () => <div>MERGES PANEL</div> }))

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
    expect(tab?.access).toEqual({ kind: 'permission', codename: Permission.BUNKING_MANAGE })
  })

  it('no longer appears under Admin', () => {
    // #1893: lodging deliberately left /admin entirely, with no redirect —
    // it was never linked, so there were no bookmarks to preserve. Nav
    // consolidation folded /admin into /manage as a mixed-access tab set, so
    // this now checks the invariant across all six tabs, not just lodging's:
    // nothing in MANAGE_TABS should ever point back under /admin.
    expect(MANAGE_TABS.some((t) => t.path.startsWith('/admin'))).toBe(false)
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

  it('renders the merge repair queue', () => {
    renderAt('/manage/lodging/merges')
    expect(screen.getByText('MERGES PANEL')).toBeInTheDocument()
  })

  it('falls back to units for an unknown section rather than rendering nothing', () => {
    renderAt('/manage/lodging/nonsense')
    expect(screen.getByText('UNITS PANEL')).toBeInTheDocument()
  })

  it('links to all four sections', () => {
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
    expect(screen.getByRole('link', { name: 'Merge repairs' })).toHaveAttribute(
      'href',
      '/manage/lodging/merges'
    )
  })
})
