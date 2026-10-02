import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GRID_ROWS } from '../../components/camperships/requests/gridFixtures'
import type { HouseholdLinks } from '../../components/camperships/requests/RequestsGrid'
import AidRequestsPage from './AidRequestsPage'

const seen: Array<{ links: HouseholdLinks; onHighlight: (key: string | null) => void }> = []
vi.mock('../../components/camperships/requests/RequestsGrid', () => ({
  RequestsGrid: (props: { links: HouseholdLinks; onHighlight: (key: string | null) => void }) => {
    seen.push({ links: props.links, onHighlight: props.onHighlight })
    return (
      <button type="button" onClick={() => props.onHighlight('reqliam00000002')}>
        Highlight
      </button>
    )
  },
}))
vi.mock('../../hooks/camperships/useAidGrid', () => ({
  useAidGrid: () => ({
    data: { year: 2027, rules_version: 1, rows: [...GRID_ROWS] },
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../../hooks/camperships/useAidRules', () => ({
  useAidApprovedRules: () => ({ data: undefined }),
}))
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: () => null,
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
let granted: string[] = ['financial_aid.view']
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
// One mutation function for the whole file, as react-query's own is stable.
const mutateAsync = vi.fn()
vi.mock('../../hooks/camperships/useAidWrites', () => ({
  useAidKeyAsk: () => ({ mutateAsync }),
  useAidTickAccepted: () => ({ mutateAsync, isPending: false }),
}))

function Where() {
  const { search } = useLocation()
  return (
    <div>
      <span data-testid="search">{search}</span>
      <span data-testid="nav">{useNavigationType()}</span>
    </div>
  )
}

beforeEach(() => {
  seen.length = 0
  granted = ['financial_aid.view']
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/aid/requests']}>
      <Routes>
        <Route
          path="/aid/requests"
          element={
            <>
              <AidRequestsPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('AidRequestsPage URL writes', () => {
  it('keeps links and onHighlight stable across a highlight move, and writes with replace', async () => {
    renderPage()
    const first = seen[seen.length - 1]
    await userEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    expect(screen.getByTestId('search')).toHaveTextContent('row=reqliam00000002')
    expect(screen.getByTestId('nav')).toHaveTextContent('REPLACE')
    const last = seen[seen.length - 1]
    expect(seen.length).toBeGreaterThan(1)
    expect(last?.links).toBe(first?.links)
    expect(last?.onHighlight).toBe(first?.onHighlight)
  })

  it('keeps links stable across a highlight move for casework holders too (the walk is stable)', async () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    renderPage()
    const first = seen[seen.length - 1]
    await userEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    expect(screen.getByTestId('search')).toHaveTextContent('row=reqliam00000002')
    expect(seen[seen.length - 1]?.links).toBe(first?.links)
  })
})
