/**
 * Season › History (spec §7.6; D15, D49, D76; history.html B) on screen: filters in the URL, never per
 * keystroke; paging; the registrar's view; a failed refetch keeps the rows. The reads are mocked.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidHistoryOperationDetail, ApiAidHistoryPage } from '../../../types/api-types'
import {
  DETAIL_SHARE,
  FINANCE_EMAIL,
  FINANCE_PAGE,
  OP_POSTED_LOCKING_REGISTRAR,
  OP_SHARE,
  PAGE,
  REGISTRAR_EMAIL,
} from './historyFixtures'
import { HistoryTab } from './HistoryTab'

let read: {
  data: ApiAidHistoryPage | undefined
  isLoading: boolean
  isFetching?: boolean
  error: Error | null
}
let queries: Array<Readonly<Record<string, string>>>
/** The one opened line a test reads; every other line is still loading. */
let detail: { id: string; data: ApiAidHistoryOperationDetail } | null = null
vi.mock('../../../hooks/camperships/useAidHistory', () => ({
  useAidHistory: (query: Readonly<Record<string, string>>) => {
    queries.push(query)
    return read
  },
  useAidHistoryOperation: (id: string) =>
    detail !== null && detail.id === id
      ? { data: detail.data, isLoading: false, error: null, refetch: vi.fn() }
      : { data: undefined, isLoading: true, error: null, refetch: vi.fn() },
}))
let granted: string[] = []
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const FINANCE = [...REGISTRAR, 'financial_aid.rules']

function Where() {
  const { search } = useLocation()
  // How the last URL write landed: every History write replaces (AidSeasonPage.test.tsx's handle).
  const navigation = useNavigationType()
  return (
    <div data-testid="where" data-nav={navigation}>
      {search}
    </div>
  )
}

function renderAt(path = '/aid/season/history?year=2027') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HistoryTab />
      <Where />
    </MemoryRouter>
  )
}

const where = () => new URLSearchParams(screen.getByTestId('where').textContent)
const replaced = () => expect(screen.getByTestId('where')).toHaveAttribute('data-nav', 'REPLACE')
const lastQuery = () => queries.at(-1)

beforeEach(() => {
  granted = REGISTRAR
  queries = []
  detail = null
  read = { data: PAGE, isLoading: false, error: null }
  // A pasted as-of must not be after "today" (kit/asOf.ts parseAsOf), so today is fixed.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('HistoryTab', () => {
  it("shows the season's log with its count line and the page's own line", () => {
    renderAt()
    expect(screen.getByText('Who changed what, and when. Append-only.')).toBeInTheDocument()
    expect(screen.getByText('1–3 of 3 operations')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(3)
    expect(lastQuery()).toEqual({ per_page: '50' })
  })

  it('shows the registrar no Rules chip and no Scenarios note (D49, D76)', () => {
    renderAt()
    expect(screen.queryByRole('button', { name: 'Rules' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Offers & stages' })).toBeInTheDocument()
    expect(screen.queryByText(/Scenarios/)).toBeNull()
  })

  it('shows finance the Rules chip and the Scenarios note', () => {
    granted = FINANCE
    read = { data: FINANCE_PAGE, isLoading: false, error: null }
    renderAt()
    expect(screen.getByRole('button', { name: 'Rules' })).toBeInTheDocument()
    expect(screen.getByText(/The scenario trail stays in Scenarios/)).toBeInTheDocument()
  })

  it('filters by kind through the URL, back on page 1 (D15)', async () => {
    renderAt('/aid/season/history?year=2027&page=3')
    await userEvent.click(screen.getByRole('button', { name: 'Holds' }))
    replaced()
    expect(where().get('kind')).toBe('holds')
    expect(where().has('page')).toBe(false)
    expect(where().get('year')).toBe('2027')
    expect(lastQuery()).toEqual({ kind: 'holds', per_page: '50' })
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(where().has('kind')).toBe(false)
  })

  it('filters by person from the people the read lists', async () => {
    granted = FINANCE
    read = { data: FINANCE_PAGE, isLoading: false, error: null }
    renderAt()
    const person = screen.getByRole('combobox', { name: 'Person' })
    expect(
      within(person)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Anyone', FINANCE_EMAIL, REGISTRAR_EMAIL])
    await userEvent.selectOptions(person, REGISTRAR_EMAIL)
    expect(where().get('actor')).toBe(REGISTRAR_EMAIL)
    expect(lastQuery()).toMatchObject({ actor: REGISTRAR_EMAIL })
  })

  it("keeps a pasted link's person in the list even when this page doesn't name them", () => {
    renderAt('/aid/season/history?actor=someone%40example.com')
    expect(screen.getByRole('option', { name: 'someone@example.com' })).toBeInTheDocument()
  })

  it('filters by camp day, From and Through', () => {
    renderAt()
    // jsdom has no picker, so the change is fired directly.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-03-01' } })
    expect(where().get('since')).toBe('2027-03-01')
    expect(lastQuery()).toMatchObject({ since: '2027-03-01' })
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2027-03-31' } })
    expect(where().get('until')).toBe('2027-03-31')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } })
    expect(where().has('since')).toBe(false)
  })

  it("commits a typed date only once its year is a season's, never per keystroke (I4)", () => {
    renderAt()
    // Typing the year into a date box passes through 0002-, 0020-, 0202-: each a real day.
    for (const partial of ['0002-03-01', '0020-03-01', '0202-03-01']) {
      fireEvent.change(screen.getByLabelText('From'), { target: { value: partial } })
      expect(where().has('since')).toBe(false)
    }
    expect(queries.every((q) => !('since' in q))).toBe(true)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-03-01' } })
    expect(where().get('since')).toBe('2027-03-01')
  })

  it('shows intake runs only when ticked (D49)', async () => {
    renderAt()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show intake runs' }))
    expect(where().get('intake')).toBe('1')
    expect(lastQuery()).toMatchObject({ include_intake: 'true' })
  })

  it('writes the search on Enter only, never per keystroke', async () => {
    renderAt()
    const box = screen.getByRole('searchbox', { name: 'Search' })
    expect(box).toHaveAttribute('placeholder', 'Reason, person or record id')
    const before = queries.length
    await userEvent.type(box, 'phone')
    expect(where().has('q')).toBe(false)
    expect(queries.slice(before).every((q) => !('q' in q))).toBe(true)
    await userEvent.type(box, '{Enter}')
    expect(where().get('q')).toBe('phone')
    expect(lastQuery()).toMatchObject({ q: 'phone' })
  })

  it('writes the search on leaving the box too', async () => {
    renderAt()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'emailed')
    await userEvent.click(screen.getByText('Who changed what, and when. Append-only.'))
    expect(where().get('q')).toBe('emailed')
  })

  it('opens and closes a line through `open=` (D15)', async () => {
    renderAt()
    await userEvent.click(screen.getByText('Released · 1 hold'))
    replaced()
    expect(where().get('open')).toBe('op0000000000002')
    expect(screen.getByText('Loading its rows…')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Released · 1 hold'))
    expect(where().has('open')).toBe(false)
  })

  it("builds its links with the page's as-of, as the Rules tab does (D15; I3)", () => {
    detail = { id: OP_SHARE.operation_id, data: DETAIL_SHARE }
    renderAt(`/aid/season/history?year=2027&as_of=2027-03-15&open=${OP_SHARE.operation_id}`)
    expect(screen.getByRole('link', { name: 'Household 1000002 ›' })).toHaveAttribute(
      'href',
      '/aid/households/1000002?year=2027&as_of=2027-03-15'
    )
    // The read itself stays live: the router takes no as-of.
    expect(lastQuery()).toEqual({ per_page: '50' })
  })

  it('pages newer and older through the URL', async () => {
    read = { data: { ...PAGE, total: 120 }, isLoading: false, error: null }
    renderAt()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Older' }))
    replaced()
    expect(where().get('page')).toBe('2')
    expect(lastQuery()).toMatchObject({ page: '2' })
  })

  it('says when a page is past the end, and Newer goes to the last page', async () => {
    read = { data: { ...PAGE, page: 9, total: 60, operations: [] }, isLoading: false, error: null }
    renderAt('/aid/season/history?page=9')
    expect(screen.getByText('Nothing on page 9: 60 operations match.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Newer' }))
    expect(where().get('page')).toBe('2')
  })

  it('says when nothing matches, keeping the filters on screen', () => {
    read = { data: { ...PAGE, total: 0, operations: [] }, isLoading: false, error: null }
    renderAt('/aid/season/history?kind=grants')
    expect(screen.getByText('No operations match.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grants' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull()
  })

  it('keeps the rows on a failed refetch (owner Group 5)', () => {
    read = { data: PAGE, isLoading: false, error: new Error('refetch failed') }
    renderAt()
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(3)
  })

  it("asks the registrar's read without a Rules kind even from finance's pasted link", () => {
    renderAt('/aid/season/history?kind=rules')
    expect(lastQuery()).toEqual({ per_page: '50' })
  })

  it('keeps the rows on screen while the next page loads', () => {
    read = { data: PAGE, isLoading: false, isFetching: true, error: null }
    renderAt('/aid/season/history?page=2')
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(3)
    expect(screen.queryByText(/Loading/)).toBeNull()
  })

  it("reads a round's first Posted tick to the registrar without a rules part (H6)", () => {
    read = {
      data: { ...PAGE, total: 1, operations: [OP_POSTED_LOCKING_REGISTRAR] },
      isLoading: false,
      error: null,
    }
    renderAt()
    expect(screen.getByText('Posted · 380 decisions')).toBeInTheDocument()
    expect(screen.queryByText(/Rules v3/)).toBeNull()
  })
})
