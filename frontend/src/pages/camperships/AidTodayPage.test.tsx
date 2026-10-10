/**
 * Today (spec 2026-10-10 §2-§7): one page per permission set, drawn from one read. The hooks are mocked;
 * the heroes, the to-do table and the model have their own tests.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BUDGET,
  line,
  REGISTRAR_TODAY,
  SOURCES,
} from '../../components/camperships/today/todayFixtures'
import type { ApiAidDevelopment, ApiAidToday } from '../../types/api-types'
import AidTodayPage from './AidTodayPage'

let granted: string[] = []
let todayState: 'ok' | 'loading' | 'error' = 'ok'
let todayData: ApiAidToday = REGISTRAR_TODAY
let budgetFails = false
let developmentFails = false

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
  development: [
    line('no_contact', 2, { item_kind: 'funders', names: ['Riverbend', 'Lakeside'] }),
    line('needs_group', 1, { item_kind: 'funders', names: ['Pinewood'] }),
  ],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/aid/today']}>
      <AidTodayPage />
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

  it('finance shows the registrar queue only when its own list is short', async () => {
    granted = FINANCE
    todayData = {
      ...REGISTRAR_TODAY,
      finance: [line('pending_approval', 6), line('rules_sections', 1), line('sources', 3)],
    }
    renderPage()
    await screen.findByText('Waiting on you')
    expect(screen.queryByText("The registrar's queue")).toBeNull()
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
})
