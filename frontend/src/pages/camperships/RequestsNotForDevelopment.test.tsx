/**
 * The development persona has no Requests access (owner ★9, final-v2/requests.html's `!CF.can('view')`):
 * a dead-end "Access Restricted" becomes one card in staff words with the three places development works
 * from. Access itself is unchanged: the route still demands financial_aid.view.
 */
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import RequestsNotForDevelopment from './RequestsNotForDevelopment'

vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../../hooks/camperships/useAidAsOf', () => ({ useAidAsOf: () => ({ kind: 'live' }) }))

describe('RequestsNotForDevelopment', () => {
  it('says so in staff words and links the three places development works from', () => {
    render(
      <MemoryRouter>
        <RequestsNotForDevelopment />
      </MemoryRouter>
    )
    expect(screen.getByText("Requests isn't part of the development view.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reports › Development' })).toHaveAttribute(
      'href',
      '/aid/reports/development?year=2027'
    )
    expect(screen.getByRole('link', { name: 'ZIP codes' })).toHaveAttribute(
      'href',
      '/aid/reports/zip-codes?year=2027'
    )
    expect(screen.getByRole('link', { name: 'Money › Funders' })).toHaveAttribute(
      'href',
      '/aid/money/funders?year=2027'
    )
    expect(screen.queryByText('Access Restricted')).toBeNull()
  })
})

// Source-level, like config/aidRoutes.guard.test.ts: rendering App's provider stack isn't practical.
describe("the /aid/requests route's fallback in App.tsx", () => {
  const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf-8')
  const at = app.indexOf('const REQUESTS_FALLBACK')
  const fallback = app.slice(at, app.indexOf('\n)\n', at))

  it('is for the development persona only: anyone else still gets the denied page', () => {
    expect(at).toBeGreaterThan(-1)
    // Camperships opens with view OR summary, so summary without view is development (programAccess.ts).
    expect(fallback).toMatch(
      /<RequirePermission permission=\{Permission\.FINANCIAL_AID_SUMMARY\}>[\s\S]*<RequestsNotForDevelopment \/>/
    )
  })

  it('isolates a crash in its own page boundary, like every lazy route', () => {
    expect(fallback).toMatch(
      /<ErrorBoundary>\s*<Suspense fallback=\{<PageSkeleton \/>\}>\s*<RequestsNotForDevelopment \/>/
    )
  })
})
