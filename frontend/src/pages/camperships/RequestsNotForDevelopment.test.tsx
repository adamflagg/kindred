/**
 * The development persona has no Requests access (owner ★9, final-v2/requests.html's `!CF.can('view')`):
 * a dead-end "Access Restricted" becomes one card in staff words with the three places development works
 * from. Access itself is unchanged: the route still demands financial_aid.view.
 */
import { render, screen } from '@testing-library/react'
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
