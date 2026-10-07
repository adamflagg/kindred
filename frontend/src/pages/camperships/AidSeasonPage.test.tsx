/**
 * Season's page (spec §7; D44, D76): its URL-held tabs, who sees which, and the as-of pill on every
 * tab while the date is past (only Rounds & budget shows that date; I6). The tabs' own bodies are
 * mocked: each has its own tests.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUDGET } from '../../components/camperships/season/budgetFixtures'
import { rulesDraft } from '../../components/camperships/season/rules/rulesFixtures'
import type { ApiAidBudget, ApiAidRulesDraft } from '../../types/api-types'
import AidSeasonPage from './AidSeasonPage'

let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../PermissionDeniedPage', () => ({ default: () => <div>Permission denied</div> }))
// A warm cache: the read returns its data whether or not a caller enables it (Task 5 m2).
let budget: ApiAidBudget = BUDGET
vi.mock('../../hooks/camperships/useAidBudget', () => ({
  useAidBudget: () => ({ data: budget, isLoading: false, error: null }),
}))
// The Season chrome's reads (Approve… and its panel), as SeasonChrome.test.tsx mocks them.
let draft: ApiAidRulesDraft | undefined = rulesDraft()
vi.mock('../../hooks/camperships/useAidRules', () => ({
  useAidRulesDraft: () => ({ data: draft, isLoading: false, error: null }),
}))
vi.mock('../../hooks/camperships/useAidRulesWrites', () => ({
  useAidApproveRules: () => ({ mutate: vi.fn(), isPending: false }),
  useFreshAidRulesDraft: () => () => Promise.resolve(draft as ApiAidRulesDraft),
}))
vi.mock('../../components/camperships/season/RoundsBudgetTab', () => ({
  RoundsBudgetTab: () => <div>Rounds and budget body</div>,
}))
vi.mock('../../components/camperships/season/HistoryTab', () => ({
  HistoryTab: () => <div>History body</div>,
}))
vi.mock('../../components/camperships/season/rules/RulesTab', () => ({
  RulesTab: () => <div>Rules tab body</div>,
}))
// Also keeps the real tab's hooks out of this suite.
vi.mock('../../components/camperships/season/scenarios/ScenariosTab', () => ({
  ScenariosTab: () => <div>Scenarios tab body</div>,
}))

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const FINANCE = [...REGISTRAR, 'financial_aid.rules']

function Where() {
  const { pathname, search } = useLocation()
  const navigation = useNavigationType()
  return (
    <div data-testid="where" data-nav={navigation}>
      {pathname + search}
    </div>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/aid/season/:tab?" element={<AidSeasonPage />} />
      </Routes>
      <Where />
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = REGISTRAR
  budget = BUDGET
  draft = rulesDraft()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidSeasonPage (spec §7; D44, D76)', () => {
  it('opens on Rounds & budget, keeping the season and the as-of, replacing the bare URL', () => {
    renderAt('/aid/season?as_of=2027-03-15')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/season/rounds-budget?year=2027&as_of=2027-03-15'
    )
    // Back must not bounce through the redirect (Task 5 m4).
    expect(screen.getByTestId('where')).toHaveAttribute('data-nav', 'REPLACE')
  })

  it("shows Rounds & budget's body, its Allocated and rules version, and the as-of pill", () => {
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    expect(screen.getByText('Rounds and budget body')).toBeInTheDocument()
    expect(screen.getByText('$1,043,600')).toBeInTheDocument()
    expect(screen.getByText('priced by rules v3')).toBeInTheDocument()
    expect(screen.getByText('As of Mar 15, 2027')).toBeInTheDocument()
  })

  it('says "no approved rules yet" in the band when no version prices the season (Task 5 m5)', () => {
    budget = { ...BUDGET, rules_version: null }
    renderAt('/aid/season/rounds-budget')
    expect(screen.getByText('no approved rules yet')).toBeInTheDocument()
    expect(screen.queryByText(/priced by rules/)).toBeNull()
  })

  it("shows the band's Allocated on Rounds & budget only, even with the read cached (Task 5 m2)", () => {
    renderAt('/aid/season/history')
    expect(screen.queryByText('$1,043,600')).toBeNull()
    expect(screen.queryByText(/priced by rules/)).toBeNull()
  })

  it('hides Scenarios from the registrar and refuses its link (D76)', () => {
    const first = renderAt('/aid/season/history')
    expect(screen.queryByRole('link', { name: 'Scenarios' })).toBeNull()
    first.unmount()
    renderAt('/aid/season/scenarios')
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
    expect(screen.queryByText('Scenarios tab body')).toBeNull()
  })

  it("mounts the Rules tab's body at /aid/season/rules (Task 11 m5)", () => {
    renderAt('/aid/season/rules')
    expect(screen.getByText('Rules tab body')).toBeInTheDocument()
  })

  it("mounts the Scenarios tab's body at /aid/season/scenarios for finance (D76; T17-m9)", () => {
    granted = FINANCE
    renderAt('/aid/season/scenarios')
    expect(screen.getByText('Scenarios tab body')).toBeInTheDocument()
    expect(screen.queryByText(/built in a later part/)).toBeNull()
  })

  it("keeps the band and the tab strip off the Scenarios tab's printout", () => {
    granted = FINANCE
    const { container } = renderAt('/aid/season/scenarios')
    const band = container.querySelector('h1')
    const nav = container.querySelector('nav')
    expect(band?.closest('.print\\:hidden')).not.toBeNull()
    expect(nav?.closest('.print\\:hidden')).not.toBeNull()
  })

  it('shows finance every tab', () => {
    granted = FINANCE
    renderAt('/aid/season/history')
    for (const name of ['Rounds & budget', 'Scenarios', 'Rules', 'History']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
  })

  // A regression guard: the mock ignores props, so this passes before the real tab lands. It pins
  // that the page mounts History's body on its tab for both readers (the interim is retired).
  it("mounts History's body on its tab, for the registrar and for finance (D49, D76)", () => {
    const first = renderAt('/aid/season/history')
    expect(screen.getByText('History body')).toBeInTheDocument()
    first.unmount()
    granted = FINANCE
    renderAt('/aid/season/history')
    expect(screen.getByText('History body')).toBeInTheDocument()
  })
})

describe('the tab bar right side (spec §4; Review Focus 5)', () => {
  it.each(['rounds-budget', 'rules', 'history', 'scenarios'])(
    'shows Approve… on %s for finance while a draft waits',
    (tab) => {
      granted = FINANCE
      renderAt(`/aid/season/${tab}`)
      const nav = screen.getByRole('navigation')
      expect(within(nav).getByRole('button', { name: 'Approve…' })).toBeInTheDocument()
    }
  )

  it('never shows Approve… to the registrar', () => {
    granted = REGISTRAR
    renderAt('/aid/season/rules')
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  it('never shows Approve… on a past date', () => {
    granted = FINANCE
    renderAt('/aid/season/history?as_of=2027-03-15')
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  it('puts the as-of sentence on the tab bar, not in a paragraph under it, and keeps the as-of pill', () => {
    renderAt('/aid/season/history?as_of=2027-03-15')
    const nav = screen.getByRole('navigation')
    expect(
      within(nav).getByText('This tab shows today. Rounds & budget can show Mar 15, 2027.')
    ).toBeInTheDocument()
    expect(screen.getByText('As of Mar 15, 2027')).toBeInTheDocument()
  })

  it('opens the Approve panel under the tab bar on a tab other than Rules', async () => {
    granted = FINANCE
    renderAt('/aid/season/history')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(screen.getByTestId('approve-form')).toBeInTheDocument()
  })

  // RulesTab is mocked here and renders no panel of its own, so a panel under the tab bar would be the page's second one.
  it('leaves the Approve panel to Rules, under its own lead line: the page mounts none there', async () => {
    granted = FINANCE
    renderAt('/aid/season/rules')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(screen.queryByTestId('approve-form')).toBeNull()
  })

  it('spaces band, tab bar and content 12px at every width', () => {
    const { container } = renderAt('/aid/season/history')
    expect(container.querySelector('.space-y-3')).not.toBeNull()
    expect(container.querySelector('[class*="sm:space-y-4"]')).toBeNull()
  })
})
