/**
 * Season › History (spec §7.6; D15, D49, D76; history.html B) on screen: filters in the URL, never per
 * keystroke; paging; the registrar's view; a failed refetch keeps the rows. The reads are mocked.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router'
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

let pages: {
  data: { pages: ApiAidHistoryPage[] } | undefined
  isLoading: boolean
  error: Error | null
  isPlaceholderData: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: ReturnType<typeof vi.fn>
}
let pageQueries: Array<Readonly<Record<string, string>>>
vi.mock('../../../hooks/camperships/useAidHistoryPages', () => ({
  useAidHistoryPages: (query: Readonly<Record<string, string>>) => {
    pageQueries.push(query)
    return pages
  },
}))
/** The one opened line a test reads; every other line is still loading. */
let detail: { id: string; data: ApiAidHistoryOperationDetail } | null = null
vi.mock('../../../hooks/camperships/useAidHistory', () => ({
  useAidHistoryOperation: (id: string) =>
    detail !== null && detail.id === id
      ? { data: detail.data, isLoading: false, error: null, refetch: vi.fn() }
      : { data: undefined, isLoading: true, error: null, refetch: vi.fn() },
}))

const opsPage = (n: number, count: number, total = 112, from = 0): ApiAidHistoryPage => ({
  ...PAGE,
  page: n,
  per_page: 50,
  total,
  operations: Array.from({ length: count }, (_, i) => ({
    ...PAGE.operations[0]!,
    operation_id: `op${String(from + i).padStart(13, '0')}`,
  })),
})
/** One page of a read, as the older tests put it (a single page of the log). */
const only = (page: ApiAidHistoryPage) => ({ pages: [page] })
let granted: string[] = []
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: () => undefined,
}))

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

/** A URL change from elsewhere (Back, a pasted link): fired without moving focus. */
function Jump({ to, testId = 'jump' }: { to: string; testId?: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => void navigate(to, { replace: true })}
    />
  )
}

function tree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <HistoryTab />
      <Where />
      <Jump to="/aid/season/history?since=2027-02-01" />
      <Jump to="/aid/season/history?q=emailed" testId="jump-q" />
    </MemoryRouter>
  )
}

function renderAt(path = '/aid/season/history?year=2027') {
  const view = render(tree(path))
  // Re-renders in place: the same MemoryRouter instance keeps its current URL (initialEntries is read once).
  return { ...view, refresh: () => view.rerender(tree(path)) }
}

const where = () => new URLSearchParams(screen.getByTestId('where').textContent)
const replaced = () => expect(screen.getByTestId('where')).toHaveAttribute('data-nav', 'REPLACE')
const lastQuery = () => pageQueries.at(-1)

beforeEach(() => {
  granted = REGISTRAR
  pageQueries = []
  detail = null
  pages = {
    data: only(PAGE),
    isLoading: false,
    error: null,
    isPlaceholderData: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }
  // A pasted as-of must not be after "today" (kit/asOf.ts parseAsOf), so today is fixed.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('HistoryTab', () => {
  it("shows the season's log, its count in the box footer (the purpose line is gone, owner 10-06)", () => {
    renderAt()
    expect(screen.getByTestId('history-footer')).toHaveTextContent('3 operations')
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(3)
    expect(lastQuery()).toEqual({ per_page: '50' })
  })

  it('shows the registrar no Rules chip and no Scenarios note (D49, D76)', () => {
    renderAt()
    expect(screen.queryByRole('button', { name: /^Rules/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Offers & stages 1' })).toBeInTheDocument()
    expect(screen.queryByText(/Scenarios/)).toBeNull()
  })

  it('shows finance the Rules chip and the Scenarios note', () => {
    granted = FINANCE
    pages.data = only(FINANCE_PAGE)
    renderAt()
    expect(screen.getByRole('button', { name: 'Rules 3' })).toBeInTheDocument()
    expect(screen.getByText(/The scenario trail stays in Scenarios/)).toBeInTheDocument()
  })

  it('counts each chip as the server counts it, and shows "—" for every count while it loads (H5; spec §7.2 A)', () => {
    renderAt()
    expect(screen.getByRole('button', { name: 'Holds 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grants 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All 3' })).toBeInTheDocument()
    pages = { ...pages, data: undefined, isLoading: true }
    renderAt()
    expect(screen.getAllByRole('button', { name: 'Holds —' })).toHaveLength(1)
  })

  it('filters by kind through the URL, back on page 1 (D15)', async () => {
    renderAt('/aid/season/history?year=2027&page=3')
    await userEvent.click(screen.getByRole('button', { name: 'Holds 1' }))
    replaced()
    expect(where().get('kind')).toBe('holds')
    expect(where().has('page')).toBe(false)
    expect(where().get('year')).toBe('2027')
    expect(lastQuery()).toEqual({ kind: 'holds', per_page: '50' })
    await userEvent.click(screen.getByRole('button', { name: 'All 3' }))
    expect(where().has('kind')).toBe(false)
  })

  it('filters by person from the people the read lists', async () => {
    granted = FINANCE
    pages.data = only(FINANCE_PAGE)
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

  it('filters by camp day, From and Through, on leaving the box', () => {
    renderAt()
    // jsdom has no picker, so the change is fired directly; the day lands when the box is left.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-03-01' } })
    fireEvent.blur(screen.getByLabelText('From'))
    expect(where().get('since')).toBe('2027-03-01')
    expect(lastQuery()).toMatchObject({ since: '2027-03-01' })
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2027-03-31' } })
    fireEvent.blur(screen.getByLabelText('Through'))
    expect(where().get('until')).toBe('2027-03-31')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } })
    fireEvent.blur(screen.getByLabelText('From'))
    expect(where().has('since')).toBe(false)
  })

  it('writes a typed day on Enter too', () => {
    renderAt()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-03-01' } })
    fireEvent.keyDown(screen.getByLabelText('From'), { key: 'Enter' })
    expect(where().get('since')).toBe('2027-03-01')
  })

  it('writes nothing while a date is typed segment by segment, until blur (I1)', () => {
    renderAt()
    // A browser fires change on each digit once the box holds a whole day: 04/20 -> 04/01 -> 04/15.
    for (const day of ['2027-04-20', '2027-04-01', '2027-04-15']) {
      fireEvent.change(screen.getByLabelText('From'), { target: { value: day } })
      expect(where().has('since')).toBe(false)
    }
    expect(pageQueries.every((q) => !('since' in q))).toBe(true)
    fireEvent.blur(screen.getByLabelText('From'))
    expect(where().get('since')).toBe('2027-04-15')
  })

  it("commits a typed date only once its year is a season's (I4)", () => {
    renderAt()
    // Typing the year into a date box passes through 0002-, 0020-, 0202-: each a real day.
    for (const partial of ['0002-03-01', '0020-03-01', '0202-03-01']) {
      fireEvent.change(screen.getByLabelText('From'), { target: { value: partial } })
    }
    fireEvent.blur(screen.getByLabelText('From'))
    expect(where().has('since')).toBe(false)
    expect(pageQueries.every((q) => !('since' in q))).toBe(true)
    // A day the box can't keep goes back to the URL's.
    expect(screen.getByLabelText('From')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-03-01' } })
    fireEvent.blur(screen.getByLabelText('From'))
    expect(where().get('since')).toBe('2027-03-01')
  })

  it('shows a URL change in the date box and keeps focus there (Back, a pasted link)', () => {
    renderAt()
    const box = screen.getByLabelText('From')
    box.focus()
    fireEvent.click(screen.getByTestId('jump'))
    expect(where().get('since')).toBe('2027-02-01')
    expect(screen.getByLabelText('From')).toBe(box)
    expect(box).toHaveValue('2027-02-01')
    expect(box).toHaveFocus()
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
    const before = pageQueries.length
    await userEvent.type(box, 'phone')
    expect(where().has('q')).toBe(false)
    expect(pageQueries.slice(before).every((q) => !('q' in q))).toBe(true)
    await userEvent.type(box, '{Enter}')
    expect(where().get('q')).toBe('phone')
    expect(lastQuery()).toMatchObject({ q: 'phone' })
  })

  it('keeps focus in the search box after Enter, so the next word can be typed', async () => {
    renderAt()
    const box = screen.getByRole('searchbox', { name: 'Search' })
    await userEvent.type(box, 'phone{Enter}')
    expect(where().get('q')).toBe('phone')
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBe(box)
    expect(box).toHaveFocus()
    await userEvent.type(box, ' call')
    expect(box).toHaveValue('phone call')
  })

  it('writes the search on leaving the box too', async () => {
    renderAt()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'emailed')
    // Leaving the box: any click elsewhere (the purpose line it used is gone).
    await userEvent.click(screen.getByTestId('where'))
    expect(where().get('q')).toBe('emailed')
  })

  it('opens and closes a line through `open=` (D15)', async () => {
    renderAt()
    await userEvent.click(screen.getByText('Released · 1 request · 1 family'))
    replaced()
    expect(where().get('open')).toBe('op0000000000002')
    expect(screen.getByText('Loading its rows…')).toBeInTheDocument()
    // The opened row's left panel says it again (spec §7.2 D); the line itself comes first.
    await userEvent.click(screen.getAllByText('Released · 1 request · 1 family')[0] as HTMLElement)
    expect(where().has('open')).toBe(false)
  })

  it("builds its links with the page's as-of, as the Rules tab does (D15; I3)", () => {
    detail = { id: OP_SHARE.operation_id, data: DETAIL_SHARE }
    renderAt(`/aid/season/history?year=2027&as_of=2027-03-15&open=${OP_SHARE.operation_id}`)
    // The row block's link and Open's, both with the as-of.
    for (const link of screen.getAllByRole('link', { name: 'The Chen Family ›' })) {
      expect(link).toHaveAttribute('href', '/aid/households/1000002?year=2027&as_of=2027-03-15')
    }
    // The read itself stays live: the router takes no as-of.
    expect(lastQuery()).toEqual({ per_page: '50' })
  })

  it('says when nothing matches, keeping the filters on screen', () => {
    pages.data = only({ ...PAGE, total: 0, operations: [] })
    renderAt('/aid/season/history?kind=grants')
    expect(screen.getByText('No operations match.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Grants/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull()
  })

  it('keeps the rows on a failed refetch (owner Group 5)', () => {
    pages.error = new Error('refetch failed')
    renderAt()
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(3)
  })

  it("asks the registrar's read without a Rules kind even from finance's pasted link", () => {
    renderAt('/aid/season/history?kind=rules')
    expect(lastQuery()).toEqual({ per_page: '50' })
  })

  it('keeps the rows on screen while the next page loads', () => {
    pages.isFetchingNextPage = true
    renderAt('/aid/season/history?page=2')
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(3)
    expect(screen.queryByText(/Loading/)).toBeNull()
  })

  it("reads a round's first Posted tick to the registrar without a rules part (H6)", () => {
    pages.data = only({ ...PAGE, total: 1, operations: [OP_POSTED_LOCKING_REGISTRAR] })
    renderAt()
    expect(
      screen.getByText('Posted · 380 requests · 352 families · $539,600 locked')
    ).toBeInTheDocument()
    expect(screen.queryByText(/Rules v3/)).toBeNull()
  })

  it('says so when the first read fails', () => {
    pages = { ...pages, data: undefined, error: new Error('down') }
    renderAt()
    expect(screen.getByText(/Failed to load History data/)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(0)
  })

  it('says so while the first read loads', () => {
    pages = { ...pages, data: undefined, isLoading: true }
    renderAt()
    expect(screen.getByText(/Loading History data/)).toBeInTheDocument()
  })

  it('marks the rows stale while the next page or filter loads', () => {
    pages.isPlaceholderData = true
    renderAt()
    expect(screen.getByTestId('history-footer')).toHaveTextContent('Updating…')
    expect(document.querySelector('[data-operation]')?.closest('[data-stale]')).not.toBeNull()
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(3)
  })

  it('does not mark a settled page stale', () => {
    renderAt()
    expect(screen.queryByText(/Updating/)).toBeNull()
    expect(document.querySelector('[data-stale]')).toBeNull()
  })

  it('puts a partly erased date box back to the URL day, and clears only a truly empty one', () => {
    renderAt('/aid/season/history?since=2027-02-01')
    const box = screen.getByLabelText('From')
    // A browser reports value '' with badInput while a segment is erased: not "no date".
    Object.defineProperty(box, 'validity', { value: { badInput: true }, configurable: true })
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)
    expect(where().get('since')).toBe('2027-02-01')
    expect(box).toHaveValue('2027-02-01')
    Object.defineProperty(box, 'validity', { value: { badInput: false }, configurable: true })
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)
    expect(where().has('since')).toBe(false)
  })

  it.each([
    ['blur', (box: HTMLElement) => fireEvent.blur(box)],
    ['Enter', (box: HTMLElement) => fireEvent.keyDown(box, { key: 'Enter' })],
  ])('resets the DOM of a partly typed box when the URL has no day, on %s', (_name, leave) => {
    renderAt('/aid/season/history')
    const box = screen.getByLabelText('From')
    // A browser keeps value '' with badInput for a lone month segment; React sees no change to undo.
    const sets: string[] = []
    Object.defineProperty(box, 'validity', { value: { badInput: true }, configurable: true })
    Object.defineProperty(box, 'value', {
      get: () => sets[sets.length - 1] ?? '',
      set: (next: string) => sets.push(next),
      configurable: true,
    })
    leave(box)
    expect(sets).toContain('')
    expect(where().has('since')).toBe(false)
  })

  it('does not mark a page stale just because a read is in flight', () => {
    pages.isFetchingNextPage = true
    renderAt()
    expect(screen.queryByText(/Updating/)).toBeNull()
    expect(document.querySelector('[data-stale]')).toBeNull()
  })

  it('shows a URL change in the search box and keeps the same box', () => {
    renderAt()
    const box = screen.getByRole('searchbox', { name: 'Search' })
    fireEvent.click(screen.getByTestId('jump-q'))
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBe(box)
    expect(box).toHaveValue('emailed')
  })
})

describe('History box (spec §7.2 C)', () => {
  it('drops the purpose line (owner 10-06)', () => {
    renderAt('/aid/season/history')
    expect(screen.queryByText('Who changed what, and when. Append-only.')).toBeNull()
  })

  it('shows 50 rows, a "Scroll for 51–100" row, and the footer words', () => {
    pages.data = { pages: [opsPage(1, 50)] }
    renderAt('/aid/season/history')
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(50)
    expect(screen.getByText('Scroll for 51–100')).toBeInTheDocument()
    const footer = screen.getByTestId('history-footer')
    expect(footer).toHaveTextContent('112 operations')
    expect(footer).toHaveTextContent('Page 1 of 3')
    expect(footer).toHaveTextContent('· 1–50 on screen; scroll for more')
    expect(within(footer).getByRole('button', { name: 'Newer' })).toBeDisabled()
    expect(within(footer).getByRole('button', { name: '1' })).toHaveClass('bg-primary')
  })

  it('loads the next page when the box scrolls within 160px of its end', () => {
    pages.data = { pages: [opsPage(1, 50)] }
    renderAt('/aid/season/history')
    const box = screen.getByTestId('history-box')
    Object.defineProperties(box, {
      scrollHeight: { value: 2000, configurable: true },
      clientHeight: { value: 600, configurable: true },
      scrollTop: { value: 1300, configurable: true, writable: true },
    })
    fireEvent.scroll(box)
    expect(pages.fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('starts each later page with its page-break row', () => {
    pages.data = { pages: [opsPage(1, 50), opsPage(2, 50, 112, 50)] }
    renderAt('/aid/season/history')
    expect(screen.getByText('Page 2 · 51–100')).toBeInTheDocument()
  })

  it('a row logged between pages is not shown twice (Review Focus 4)', () => {
    pages.data = { pages: [opsPage(1, 50), opsPage(2, 50, 112, 49)] } // page 2 repeats page 1's last row
    renderAt('/aid/season/history')
    expect(document.querySelectorAll('[data-operation]')).toHaveLength(99)
  })

  it('a link with ?page=3 loads every page up to 3', () => {
    pages.data = { pages: [opsPage(1, 50)] }
    renderAt('/aid/season/history?page=3')
    expect(pages.fetchNextPage).toHaveBeenCalled()
    expect(pageQueries.at(-1)).not.toHaveProperty('page')
  })

  it('dims the old rows, says Updating… and dims the counts while a filter re-reads', () => {
    pages.data = { pages: [opsPage(1, 10, 10)] }
    pages.isPlaceholderData = true
    renderAt('/aid/season/history?kind=offers')
    expect(screen.getByTestId('history-rows')).toHaveAttribute('data-stale')
    expect(screen.getByTestId('history-footer')).toHaveTextContent('Updating…')
    expect(screen.getAllByTestId('history-count')[0]).toHaveClass('opacity-35')
  })

  it('says "No operations match." when nothing does', () => {
    pages.data = { pages: [opsPage(1, 0, 0)] }
    renderAt('/aid/season/history?q=nobody')
    expect(screen.getByText('No operations match.')).toBeInTheDocument()
  })

  it('loading and failing read as QueryGuard words inside the box', () => {
    pages.data = undefined
    pages.isLoading = true
    renderAt('/aid/season/history')
    expect(
      within(screen.getByTestId('history-box')).getByText(/Loading History data/)
    ).toBeInTheDocument()
  })
})

describe('History box scroll position (spec §7.2 C, F)', () => {
  let scrolledTo: Array<string | null>
  beforeEach(() => {
    scrolledTo = []
    // jsdom has no scrollIntoView: record which page-break row asked to be shown.
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolledTo.push(this.getAttribute('data-page-start'))
    }
  })
  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
  })

  /** The box as if the person had scrolled it to `top` (jsdom lays nothing out). */
  const scrolledBox = (top: number) => {
    const box = screen.getByTestId('history-box')
    Object.defineProperty(box, 'scrollTop', { value: top, configurable: true, writable: true })
    return box
  }
  const footerButton = (name: string) =>
    within(screen.getByTestId('history-footer')).getByRole('button', { name })

  it('a page change writes ?page= and leaves the box where it is', () => {
    pages.data = { pages: [opsPage(1, 50), opsPage(2, 50, 112, 50)] }
    renderAt('/aid/season/history')
    const box = scrolledBox(2100)
    fireEvent.click(footerButton('2'))
    expect(where().get('page')).toBe('2')
    expect(box.scrollTop).toBe(2100)
    expect(scrolledTo).toEqual(['2'])
  })

  it('a filter change returns the box to its top (regression guard)', () => {
    pages.data = { pages: [opsPage(1, 50), opsPage(2, 50, 112, 50)] }
    renderAt('/aid/season/history?page=2')
    const box = scrolledBox(2100)
    fireEvent.click(screen.getByTestId('jump-q'))
    expect(where().get('page')).toBeNull()
    expect(box.scrollTop).toBe(0)
  })

  it('a ?page=3 link scrolls to page 3 once pages 2 and 3 have arrived, not before', () => {
    pages.data = { pages: [opsPage(1, 50)] }
    const view = renderAt('/aid/season/history?page=3')
    expect(pages.fetchNextPage).toHaveBeenCalled()
    expect(scrolledTo).toEqual([])
    pages.data = { pages: [opsPage(1, 50), opsPage(2, 50, 112, 50)] }
    view.refresh()
    expect(scrolledTo).toEqual([])
    pages.data = { pages: [opsPage(1, 50), opsPage(2, 50, 112, 50), opsPage(3, 12, 112, 100)] }
    view.refresh()
    expect(scrolledTo).toEqual(['3'])
  })

  it('a page number not loaded yet loads it, then scrolls to it', () => {
    pages.data = { pages: [opsPage(1, 50), opsPage(2, 50, 112, 50)] }
    const view = renderAt('/aid/season/history?page=2')
    scrolledTo = [] // the link itself showed page 2
    fireEvent.click(footerButton('3'))
    expect(where().get('page')).toBe('3')
    expect(pages.fetchNextPage).toHaveBeenCalled()
    expect(scrolledTo).toEqual([])
    pages.data = { pages: [opsPage(1, 50), opsPage(2, 50, 112, 50), opsPage(3, 12, 112, 100)] }
    view.refresh()
    expect(scrolledTo).toEqual(['3'])
  })
})
