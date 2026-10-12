/**
 * Today (spec 2026-10-10 §2-§7): one page per permission set, drawn from one read. The hooks are mocked;
 * the heroes, the to-do table and the model have their own tests.
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BUDGET,
  line,
  REGISTRAR_TODAY,
  SOURCES,
  STAGES,
} from '../../components/camperships/today/todayFixtures'
import type { ApiAidDevelopment, ApiAidToday, ApiAidTodayWeek } from '../../types/api-types'
import AidTodayPage from './AidTodayPage'

let granted: string[] = []
let todayState: 'ok' | 'loading' | 'error' = 'ok'
let todayData: ApiAidToday = REGISTRAR_TODAY
let budgetFails = false
let developmentFails = false
let weekFails = false
const weekData: ApiAidTodayWeek = {
  year: 2027,
  week_of: '2027-04-05',
  registrar: [{ key: 'posted', label: 'Offers posted', value: 14, previous: 9, unit: 'count' }],
  finance: [{ key: 'avg', label: 'Avg award', value: 2080, previous: 2140, unit: 'dollars' }],
  development: [{ key: 'grants', label: 'Grants in', value: 2, previous: 1, unit: 'count' }],
  feed: [
    {
      kind: 'funder',
      at: '2027-04-06T17:14:00Z',
      words: 'Regional Fund updated',
      name: 'Regional Fund',
      household_cm_id: null,
      href_kind: 'funders',
    },
  ],
}

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../../hooks/camperships/useAidToday', () => ({
  useAidToday: () =>
    todayState === 'loading'
      ? { data: undefined, isLoading: true, error: null }
      : todayState === 'error'
        ? { data: undefined, isLoading: false, error: new Error('boom') }
        : { data: todayData, isLoading: false, error: null },
}))
vi.mock('../../hooks/camperships/useAidTodayWeek', () => ({
  useAidTodayWeek: () =>
    weekFails
      ? { data: undefined, isLoading: false, error: new Error('week down') }
      : { data: weekData, isLoading: false, error: null },
}))
vi.mock('../../hooks/camperships/useAidBudget', () => ({
  useAidBudget: () =>
    budgetFails
      ? { data: undefined, isLoading: false, error: new Error('budget down') }
      : { data: BUDGET, isLoading: false, error: null },
}))
const DEVELOPMENT_READ = {
  year: 2027,
  figures_on: '2027-04-10',
  groups: [],
  not_built: [],
  sources: SOURCES,
  columns: [
    { season: 2026, basis: 'r', as_of: null, label: '2026' },
    { season: 2027, basis: 'P', as_of: '2027-04-10', label: '2027' },
  ],
  rows: [
    {
      key: 'awards',
      section: 'money',
      label: 'Grants/Awards',
      group: null,
      unit: 'count',
      definition: '',
      values: [480, 521],
    },
  ],
} as unknown as ApiAidDevelopment
vi.mock('../../hooks/camperships/useAidDevelopment', () => ({
  useAidDevelopment: () =>
    developmentFails
      ? { data: undefined, isLoading: false, error: new Error('development down') }
      : { data: DEVELOPMENT_READ, isLoading: false, error: null },
}))
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: ({ surface }: { surface: string }) => <div>notes:{surface}</div>,
}))
vi.mock('../PermissionDeniedPage', () => ({ default: () => <div>Permission denied</div> }))

const FINANCE_TODAY: ApiAidToday = {
  ...REGISTRAR_TODAY,
  finance: [line('pending_approval', 6), line('rules_sections', 1), line('sources', 3)],
  posted_by_week: [
    { week_of: '2027-01-04', posted: 0 },
    { week_of: '2027-03-29', posted: 843380 },
  ],
  development: [
    line('no_contact', 2, { item_kind: 'funders', names: ['Riverbend', 'Lakeside'] }),
    line('needs_group', 1, { item_kind: 'funders', names: ['Pinewood'] }),
  ],
}

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderPage(path = '/aid/today') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/aid/today"
          element={
            <>
              <AidTodayPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

const FINANCE = ['financial_aid.view', 'financial_aid.casework', 'financial_aid.rules']
const DEVELOPMENT = ['financial_aid.summary', 'financial_aid.grantors']

beforeEach(() => {
  granted = []
  todayState = 'ok'
  budgetFails = false
  developmentFails = false
  weekFails = false
  todayData = FINANCE_TODAY
})

describe('AidTodayPage', () => {
  it.each([
    [['financial_aid.view', 'financial_aid.casework'], 'The season so far', 'Your to-dos'],
    [FINANCE, 'Budget, all pools', 'Waiting on you'],
    [DEVELOPMENT, "Where this season's aid came from", 'Funder upkeep'],
  ])('%j draws its own page', async (perms, hero, heading) => {
    granted = perms
    renderPage()
    expect(await screen.findByRole('heading', { name: hero })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('the band greets and reads the day', async () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    renderPage()
    expect(await screen.findByText('Good morning')).toBeInTheDocument()
    expect(
      screen.getByText(/2 lines are overdue, and 31 requests need an offer/)
    ).toBeInTheDocument()
  })

  it('shows each page its own notes surface', async () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    renderPage()
    expect(await screen.findByText('notes:today_registrar')).toBeInTheDocument()
  })

  it("finance always gets the registrar's queue, folded, with a link to it (ruling V4)", async () => {
    granted = FINANCE
    todayData = {
      ...REGISTRAR_TODAY,
      finance: [line('pending_approval', 6), line('rules_sections', 1), line('sources', 3)],
    }
    renderPage()
    expect(await screen.findByText("The registrar's queue")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Requests ›' })).toHaveAttribute(
      'href',
      '/aid/requests?year=2027'
    )
    expect(screen.queryByText('Needs an offer')).toBeNull() // folded until opened
  })

  it('finance with a short list of its own gets the registrar queue folded below', async () => {
    granted = FINANCE
    todayData = { ...REGISTRAR_TODAY, finance: [line('pending_approval', 1)] }
    renderPage()
    expect(await screen.findByText("The registrar's queue")).toBeInTheDocument()
  })

  it('a finance user without casework gets no registrar fold and no crash (review focus 2)', async () => {
    granted = ['financial_aid.view', 'financial_aid.rules']
    todayData = { ...REGISTRAR_TODAY, casework: null, finance: [line('pending_approval', 1)] }
    renderPage()
    await screen.findByText('Waiting on you')
    expect(screen.queryByText("The registrar's queue")).toBeNull()
  })

  it('the over-budget concern appears only when a pool is over', async () => {
    granted = FINANCE
    renderPage()
    expect(await screen.findByText('Over budget')).toBeInTheDocument()
    expect(screen.getByText('TBM $1,300 over')).toBeInTheDocument()
  })

  it('development never renders a household name, even when handed casework data', async () => {
    granted = DEVELOPMENT
    todayData = {
      ...REGISTRAR_TODAY,
      development: [line('no_contact', 1, { item_kind: 'funders', names: ['Riverbend'] })],
    }
    const { container } = renderPage()
    await screen.findByText('Funder upkeep')
    expect(container.textContent).not.toMatch(/Garcia|Chen|household/)
  })

  it('development groups the sources by reporting group, with an Every group total', async () => {
    granted = DEVELOPMENT
    renderPage()
    expect(await screen.findByText('By reporting group')).toBeInTheDocument()
    expect(screen.getByText('Every group')).toBeInTheDocument()
    expect(screen.getByText('TBM')).toBeInTheDocument()
  })

  it('a view-only user sees the season and no queue of their own', async () => {
    granted = ['financial_aid.view']
    renderPage()
    expect(await screen.findByText('Nothing is assigned to you.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The season so far' })).toBeInTheDocument()
  })

  it('refuses someone with no Camperships permission', () => {
    granted = []
    renderPage()
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it('loading zeroes nothing, a failed read says so', async () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    todayState = 'loading'
    renderPage()
    expect(screen.queryByText('0 req')).toBeNull()
    todayState = 'error'
    renderPage()
    expect(await screen.findByText(/Failed to load/i)).toBeInTheDocument()
  })

  it('a failed budget read blanks only the budget hero, not the to-dos', async () => {
    granted = FINANCE
    budgetFails = true
    renderPage()
    expect(await screen.findByText(/Failed to load the budget data/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Waiting on you' })).toBeInTheDocument()
  })

  it('a failed development read blanks only the development hero, not the upkeep list', async () => {
    granted = DEVELOPMENT
    developmentFails = true
    renderPage()
    expect(await screen.findByText(/Failed to load the funder totals data/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Funder upkeep' })).toBeInTheDocument()
  })

  it('development counts its upkeep once: the heading, the band and Upkeep left agree (audit D18)', async () => {
    granted = DEVELOPMENT
    renderPage()
    // FINANCE_TODAY's development lines: 2 funders missing a contact, 1 needing a group.
    expect(
      await screen.findByText('3 waiting · keep these complete so reports come out right')
    ).toBeInTheDocument()
    expect(screen.getByText(/3 upkeep items need a look/)).toBeInTheDocument()
    expect(screen.getByText('Upkeep left').parentElement).toHaveTextContent('3')
  })

  it('development draws Everything else only when a line in it is waiting (ruling V10)', async () => {
    granted = DEVELOPMENT
    todayData = {
      ...FINANCE_TODAY,
      development: [
        line('no_contact', 2, { item_kind: 'funders', names: ['Riverbend', 'Lakeside'] }),
        line('no_eligibility', 0, { item_kind: 'funders' }),
      ],
    }
    renderPage()
    await screen.findByText('Funder upkeep')
    expect(screen.queryByText('Everything else')).toBeNull()
  })

  it('By reporting group sits under Funder upkeep with its description and a Campers helped column (audit D10-D12)', async () => {
    granted = DEVELOPMENT
    renderPage()
    await screen.findByRole('heading', { name: 'By reporting group' })
    expect(screen.getByText('live · the figures grant reports ask for')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain(
      'Campers helped'
    )
    const left = screen.getByTestId('today-left')
    expect(within(left).getByRole('table', { name: 'By reporting group' })).toBeInTheDocument()
  })

  it('the By reporting group table has no Awards column (it would double-count; the hero has the figure)', async () => {
    granted = DEVELOPMENT
    renderPage()
    await screen.findByText('By reporting group')
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads.join('|')).toMatch(/Group/)
    expect(heads.join('|')).toMatch(/Total aid/)
    expect(heads.join('|')).toMatch(/From outside funders/)
    expect(heads.some((h) => h.startsWith('Awards'))).toBe(false)
    expect(screen.getByTestId('hero-figure')).toHaveTextContent('521')
  })

  it("the registrar fold's meta counts every live casework line, not just the five shown", async () => {
    granted = FINANCE
    todayData = { ...REGISTRAR_TODAY, finance: [line('pending_approval', 1)] }
    renderPage()
    // REGISTRAR_TODAY has ten casework lines, nine of them live; two are overdue.
    expect(
      await screen.findByText('9 waiting · 2 overdue · on the registrar, open to review')
    ).toBeInTheDocument()
  })

  it('the registrar page gets This week beside its to-dos', async () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    todayData = REGISTRAR_TODAY
    renderPage()
    expect(await screen.findByText('This week')).toBeInTheDocument()
    expect(screen.getByText('Offers posted')).toBeInTheDocument()
    // Audit R23: only the name the item marks is the link.
    expect(screen.getByRole('link', { name: 'Regional Fund' })).toHaveAttribute(
      'href',
      '/aid/money/funders'
    )
  })

  it('finance gets Committed by week above This week', async () => {
    granted = FINANCE
    const { container } = renderPage()
    expect(await screen.findByText('Committed by week')).toBeInTheDocument()
    // The series rides Today's read (the budget's own rows), not the week read.
    expect(screen.getByText(/\$843k posted/)).toBeInTheDocument()
    expect(container.querySelector('path[data-line="posted"]')).not.toBeNull()
    expect(screen.getByText('Avg award')).toBeInTheDocument()
  })

  it('development gets This week with Upkeep left, the sum of its lines, and no change shown', async () => {
    granted = DEVELOPMENT
    renderPage()
    expect(await screen.findByText('Grants in')).toBeInTheDocument()
    const label = screen.getByText('Upkeep left')
    expect(label.parentElement).toHaveTextContent('3')
    expect(label.parentElement?.textContent).not.toMatch(/[▲▼]/)
  })

  it('a view-only user gets no right column', async () => {
    granted = ['financial_aid.view']
    renderPage()
    await screen.findByText('Nothing is assigned to you.')
    expect(screen.queryByText('This week')).toBeNull()
  })

  it('a failed week read blanks only the right column, not the to-dos', async () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    todayData = REGISTRAR_TODAY
    weekFails = true
    renderPage()
    expect(await screen.findByText(/Failed to load this week/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your to-dos' })).toBeInTheDocument()
  })

  // --- final review ---------------------------------------------------------------------------------------------

  it('reads live whatever the URL says: an as-of on /aid/today is dropped, the season kept (D20)', async () => {
    granted = FINANCE
    renderPage('/aid/today?year=2027&as_of=2026-04-01&as_of_axis=recorded')
    await screen.findByRole('heading', { name: 'Budget, all pools' })
    const where = screen.getByTestId('where')
    expect(where).toHaveTextContent('/aid/today?year=2027')
    expect(where.textContent).not.toMatch(/as_of/)
  })

  it("finance's Posted in CM comes from the Today read's budget rows, second in the card", async () => {
    granted = FINANCE
    todayData = {
      ...FINANCE_TODAY,
      posted_this_week: {
        key: 'posted_cm',
        label: 'Posted in CM',
        value: 41250,
        previous: 30100,
        unit: 'dollars',
      },
    }
    renderPage()
    const label = await screen.findByText('Posted in CM')
    expect(label.parentElement).toHaveTextContent('$41k')
    expect(label.parentElement).toHaveTextContent('▲ $11k')
  })

  it('a failed week read still shows Committed by week, which rides the Today read', async () => {
    granted = FINANCE
    weekFails = true
    const { container } = renderPage()
    expect(await screen.findByText(/Failed to load this week/)).toBeInTheDocument()
    expect(screen.getByText('Committed by week')).toBeInTheDocument()
    expect(container.querySelector('path[data-line="posted"]')).not.toBeNull()
  })

  it('a view-only user gets the registrar hero from the stages the server sends view (spec §2, §9.3)', async () => {
    granted = ['financial_aid.view']
    todayData = { year: 2027, casework: null, finance: null, development: null, stages: STAGES }
    renderPage()
    expect(await screen.findByRole('heading', { name: 'The season so far' })).toBeInTheDocument()
    expect(screen.getAllByTestId('hero-key')[0]).toHaveTextContent('Needs an offer 31')
    expect(screen.getByText('Nothing is assigned to you.')).toBeInTheDocument()
  })
})
