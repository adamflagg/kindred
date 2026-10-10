/**
 * Season's page (spec §7; D44, D76): its URL-held tabs, who sees which, and the as-of pill on every
 * tab while the date is past (only Rounds & budget shows that date; I6). The tabs' own bodies are
 * mocked: each has its own tests.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUDGET } from '../../components/camperships/season/budgetFixtures'
import { rulesDraft } from '../../components/camperships/season/rules/rulesFixtures'
import type { ApiAidBudget, ApiAidRulesDraft } from '../../types/api-types'
import { AidApiError } from '../../services/camperships/aidApi'
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
// The registrar's `season_done` rides the approved read.
let approvedDone = false
let draftError: Error | null = null
vi.mock('../../hooks/camperships/useAidRules', () => ({
  useAidRulesDraft: () => ({ data: draft, isLoading: false, error: draftError }),
  useAidApprovedRules: () => ({
    data: { season_done: approvedDone },
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: () => undefined,
}))
vi.mock('../../hooks/camperships/useAidSessionCatalog', () => ({
  useAidSessionCatalog: () => [],
  useAidSessionCatalogError: () => null,
}))
vi.mock('../../hooks/camperships/useLodgingCancelledSessions', () => ({
  useLodgingCancelledSessions: () => new Set<number>(),
}))
vi.mock('../../hooks/camperships/useAidRulesWrites', () => ({
  useAidApproveRules: () => ({ mutate: vi.fn(), isPending: false }),
  useFreshAidRulesDraft: () => () => Promise.resolve(draft as ApiAidRulesDraft),
}))
vi.mock('../../components/camperships/season/RoundsBudgetTab', () => ({
  RoundsBudgetTab: () => <div>Rounds and budget body</div>,
  RoundsBudgetScope: () => <span>Scope stub</span>,
  RoundsBudgetCsv: () => <button type="button">Download CSV</button>,
}))
vi.mock('../../components/camperships/season/HistoryTab', () => ({
  HistoryTab: () => <div>History body</div>,
}))
// The mock shows the section the Approve panel would tick first, which the page decides (RulesTab mounts the panel).
vi.mock('../../components/camperships/season/rules/RulesTab', async () => {
  const { useSeasonChrome } = await import('../../components/camperships/season/seasonChrome')
  return {
    RulesTab: () => (
      <div>
        Rules tab body <span data-testid="approve-section">{useSeasonChrome().section}</span>
      </div>
    ),
  }
})
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
  approvedDone = false
  draftError = null
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
    expect(screen.getByText('$1,000,000')).toBeInTheDocument()
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
    expect(screen.queryByText('$1,000,000')).toBeNull()
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

  it('puts the scope first and Download CSV last on Rounds & budget only (Task 38)', () => {
    granted = FINANCE
    renderAt('/aid/season/rounds-budget')
    const nav = screen.getByRole('navigation')
    const right = [...nav.querySelectorAll('button, span')]
    const names = right.map((el) => el.textContent)
    expect(names.indexOf('Scope stub')).toBeGreaterThan(-1)
    expect(names.indexOf('Scope stub')).toBeLessThan(names.indexOf('Approve…'))
    expect(names.indexOf('Approve…')).toBeLessThan(names.indexOf('Download CSV'))
    cleanup()
    renderAt('/aid/season/history')
    expect(screen.queryByText('Scope stub')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull()
  })

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

  // #3042 DECIDE 2: Rules' own fallback is the income section (the first chapter), not Rounds & budget's budget.
  it("has Rules' Approve panel tick the income section first when the URL names none, else the named one", () => {
    granted = FINANCE
    const first = renderAt('/aid/season/rules')
    expect(screen.getByTestId('approve-section')).toHaveTextContent('income')
    first.unmount()
    renderAt('/aid/season/rules?section=budget')
    expect(screen.getByTestId('approve-section')).toHaveTextContent('budget')
  })

  // Pin changed (chrome-1/2): the mock's rhythm replaces the old 12px: band, 4px, tabs, 10px, content.
  it('spaces band to tabs 4px and the head to its content 10px at every width', () => {
    const { container } = renderAt('/aid/season/history')
    const head = screen.getByTestId('aid-page-head')
    expect(head.firstElementChild).toHaveClass('mb-1')
    expect(head.parentElement?.parentElement).toHaveClass('space-y-2.5')
    expect(container.querySelector('.space-y-3')).toBeNull()
    expect(container.querySelector('[class*="sm:space-y-4"]')).toBeNull()
  })
})

describe('a done season on the tab bar (spec §11.3)', () => {
  it('shows finance Unlock… on every tab, in Approve…’s place, and the registrar nothing', () => {
    granted = FINANCE
    draft = { ...rulesDraft(), season_done: true, configured_year: 2028 }
    for (const tab of ['rounds-budget', 'scenarios', 'rules', 'history']) {
      renderAt(`/aid/season/${tab}`)
      expect(screen.getByRole('button', { name: 'Unlock…' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
      cleanup()
    }
    granted = REGISTRAR
    approvedDone = true
    renderAt('/aid/season/history')
    expect(screen.queryByRole('button', { name: 'Unlock…' })).toBeNull()
  })

  it('opens the Unlock panel under the tab bar, and unlocking brings Approve… back with the pill', async () => {
    granted = FINANCE
    draft = { ...rulesDraft(), season_done: true, configured_year: 2028 }
    renderAt('/aid/season/history')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock…' }))
    expect(screen.getByText('Unlock 2027')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Why correct a done season?'), 'Late fix')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(screen.getByRole('button', { name: 'Unlocked: Late fix' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve…' })).toBeInTheDocument()
  })

  it("says why in amber, with no Unlock…, when the dashboard's season can't be read", () => {
    granted = FINANCE
    draft = undefined
    draftError = new AidApiError("The dashboard's season couldn't be read; try again shortly", 503)
    renderAt('/aid/season/history')
    expect(
      screen.getByText("The dashboard's season couldn't be read; try again shortly")
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock…' })).toBeNull()
  })
})
