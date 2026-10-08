/** Grants' page (spec §8.2; D55–D57; P-18): its URL-held tabs, their purpose lines and where a bare link lands. Bodies mocked. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AidGrantsPage from './AidGrantsPage'

let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../PermissionDeniedPage', () => ({
  default: () => <div>Permission denied</div>,
}))
vi.mock('../../components/camperships/grants/RegisterTab', () => ({
  RegisterTab: () => <div>Register body</div>,
}))
vi.mock('../../components/camperships/grants/NeedsAttentionTab', () => ({
  NeedsAttentionTab: () => <div>Needs attention body</div>,
}))
vi.mock('../../components/camperships/grants/ExpectedTab', () => ({
  ExpectedTab: () => <div>Expected body</div>,
}))
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: ({ surface }: { surface: string }) => <div>{`Notes: ${surface}`}</div>,
}))

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/aid/grants/:tab?" element={<AidGrantsPage />} />
      </Routes>
      <Where />
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = ['financial_aid.view']
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-20T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidGrantsPage (spec §8.2)', () => {
  it('opens on the Register, keeping the season', () => {
    renderAt('/aid/grants')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/grants/register?year=2027')
  })

  it('shows the four tabs, the Register’s purpose line, its body and the grants notes', () => {
    renderAt('/aid/grants/register')
    for (const name of ['Register', 'Needs attention', 'Expected', 'Grantors']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(
      screen.getByText(
        'Every outside grant in CampMinder this season, plus commitments typed by hand.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Register body')).toBeInTheDocument()
    expect(screen.getByText('Notes: grants')).toBeInTheDocument()
  })

  it('draws no season total in the band (review item 10)', () => {
    renderAt('/aid/grants/register')
    expect(screen.queryByText(/this season ·/)).toBeNull()
  })

  it('says Grants shows today when the link carries a past date (P-18)', () => {
    renderAt('/aid/grants/register?as_of=2027-04-01')
    expect(screen.getByText('Grants shows today: it has no past date.')).toBeInTheDocument()
  })

  it('names each tab’s purpose in the mock’s words', () => {
    renderAt('/aid/grants/needs-attention')
    expect(
      screen.getByText('Grant lines that need a person: pick the camper or fix the setup.')
    ).toBeInTheDocument()
  })

  it('shows Needs attention on its tab', () => {
    renderAt('/aid/grants/needs-attention')
    expect(screen.getByText('Needs attention body')).toBeInTheDocument()
  })

  it('shows Expected on its tab', () => {
    renderAt('/aid/grants/expected')
    expect(screen.getByText('Expected body')).toBeInTheDocument()
  })
})
