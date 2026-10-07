/**
 * Season › History's table (spec §7.6; D49; history.html B): one line per operation, opening to its
 * rows. The detail read is mocked; the rows are historyFixtures' invented season.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidHistoryOperation, ApiAidHistoryOperationDetail } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import {
  DETAIL_POSTED,
  DETAIL_RELEASE,
  DETAIL_RULES_APPROVE,
  DETAIL_SHARE,
  OP_INTAKE,
  OP_POSTED,
  OP_POSTED_LOCKING_REGISTRAR,
  OP_RELEASE,
  OP_RULES_APPROVE,
  OP_SHARE,
  REGISTRAR_EMAIL,
  row,
} from './historyFixtures'
import { HistoryTable } from './HistoryTable'

interface Read {
  data: ApiAidHistoryOperationDetail | undefined
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<unknown>
}
let reads: Record<string, Read>
const refetch = vi.fn<() => Promise<unknown>>(() => Promise.resolve())
const loaded = (data: ApiAidHistoryOperationDetail): Read => ({
  data,
  isLoading: false,
  error: null,
  refetch,
})
vi.mock('../../../hooks/camperships/useAidHistory', () => ({
  useAidHistoryOperation: (id: string) =>
    reads[id] ?? { data: undefined, isLoading: true, error: null, refetch },
}))

// The season's session names (useAidSessionNames), asked for the page's own season.
const sessionNames = new Map([
  [9300101, 'Session 1'],
  [9300102, 'Session 2'],
  [1000102, 'Session 2'],
])
vi.mock('../../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: (year: number) => (year === 2027 ? sessionNames : undefined),
}))

const VIEW: AidView = { year: 2027, asOf: { kind: 'live' } }
const onToggle = vi.fn<(id: string) => void>()

function renderTable(
  open: string[],
  operations = [OP_SHARE, OP_RELEASE, OP_POSTED, OP_RULES_APPROVE],
  view: AidView = VIEW
) {
  return render(
    <MemoryRouter>
      <HistoryTable operations={operations} open={open} onToggle={onToggle} view={view} />
    </MemoryRouter>
  )
}

const line = (id: string) => {
  const row = document.querySelector(`[data-operation="${id}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no line ${id}`)
  return row
}

beforeEach(() => {
  onToggle.mockClear()
  refetch.mockClear()
  reads = {
    [OP_SHARE.operation_id]: loaded(DETAIL_SHARE),
    [OP_RELEASE.operation_id]: loaded(DETAIL_RELEASE),
    [OP_POSTED.operation_id]: loaded(DETAIL_POSTED),
    [OP_RULES_APPROVE.operation_id]: loaded(DETAIL_RULES_APPROVE),
  }
})

describe('HistoryTable', () => {
  it('shows each operation as one line: when, who, kind, what happened, rows', () => {
    renderTable([])
    for (const header of ['When', 'Who', 'Kind', 'What happened', 'Rows']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    const posted = within(line(OP_POSTED.operation_id))
    expect(posted.getByText(/Apr 9 16:05/)).toBeInTheDocument()
    expect(posted.getByText(REGISTRAR_EMAIL)).toBeInTheDocument()
    expect(posted.getByText('Offers & stages')).toBeInTheDocument()
    expect(
      posted.getByText('Posted · 30 requests · 28 families · $42,600 locked')
    ).toBeInTheDocument()
    expect(posted.getByText('30')).toBeInTheDocument()
    expect(
      within(line(OP_RELEASE.operation_id)).getByText(/“Income confirmed by phone”/)
    ).toBeInTheDocument()
    expect(document.querySelectorAll('[data-history-row]')).toHaveLength(0)
  })

  it('toggles a line on a click anywhere on it', async () => {
    renderTable([])
    await userEvent.click(
      within(line(OP_RELEASE.operation_id)).getByText('Released · 1 request · 1 family')
    )
    expect(onToggle).toHaveBeenCalledWith(OP_RELEASE.operation_id)
  })

  it('opens a line to its rows, its reason, and who each row is about by name (H2)', () => {
    renderTable([OP_SHARE.operation_id])
    expect(line(OP_SHARE.operation_id)).toHaveTextContent('▾')
    // Spec §7.2 D: the reason is the left panel's quoted sentence, no "Reason:" label.
    expect(screen.getByText('“Family emailed”')).toBeInTheDocument()
    // Each household's row, its record id left out: the row links its household (#18).
    expect(screen.getAllByText('Household share set · payer share · Family emailed')).toHaveLength(
      2
    )
    expect(screen.queryByText(/req000000000009/)).toBeNull()
    // Spec §7.2 D: a field is a label and its value in a grid, not one "Label: value" string.
    expect(screen.getAllByText('Share pct')).toHaveLength(2)
    expect(screen.getByText('40%')).toBeInTheDocument()
    // The household reads in the row block and again under Open.
    expect(
      screen.getAllByRole('link', { name: 'The Chen Family ›' }).map((a) => a.getAttribute('href'))
    ).toEqual(['/aid/households/1000002?year=2027', '/aid/households/1000002?year=2027'])
    expect(
      screen
        .getAllByRole('link', { name: 'The Johnson Family ›' })
        .map((a) => a.getAttribute('href'))
    ).toEqual(['/aid/households/1000001?year=2027', '/aid/households/1000001?year=2027'])
    expect(screen.getAllByText(/Emma Johnson/)).toHaveLength(2)
  })

  it('shows the first 25 row blocks, then all of them on asking (D49)', async () => {
    // 30 hold events: not a request table, so each stays a row block (a 3+ run of decisions is
    // a compact table now, spec §7.2 D).
    const [release] = DETAIL_RELEASE.rows
    if (release === undefined) throw new Error('fixture')
    openWith(OP_RELEASE, {
      ...DETAIL_RELEASE,
      rows: Array.from({ length: 30 }, (_, i) => ({
        ...release,
        entity_id: `req${String(i + 1).padStart(12, '0')}:placeholder_income`,
      })),
    })
    expect(document.querySelectorAll('[data-history-row]')).toHaveLength(25)
    await userEvent.click(screen.getByRole('button', { name: 'Show all 30 rows' }))
    expect(document.querySelectorAll('[data-history-row]')).toHaveLength(30)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it("names a row's session by the season's session name, never its number", () => {
    const [shared] = DETAIL_SHARE.rows
    if (shared === undefined) throw new Error('no share row')
    const moved = {
      ...shared,
      entity: 'aid_requests',
      entity_id: 'req000000000009',
      action: 'update',
      before: { session_cm_id: 9300101 },
      after: { session_cm_id: 9300102 },
      changes: [
        { path: ['session_cm_id'], kind: 'changed' as const, before: 9300101, after: 9300102 },
      ],
    }
    reads[OP_SHARE.operation_id] = loaded({ ...DETAIL_SHARE, rows: [moved] })
    renderTable([OP_SHARE.operation_id])
    const row = document.querySelector('[data-history-row]')
    expect(row).toHaveTextContent(/· Session 2/)
    // A field is a label and its old → new value (the old struck through, spec §7.2 D).
    expect(row).toHaveTextContent('SessionSession 1 → Session 2')
    expect(row?.querySelector('s')).toHaveTextContent('Session 1')
    expect(row).not.toHaveTextContent(/93001/)
  })

  it('opens a rules line to its diff and "Open vN in Rules" (D49)', () => {
    renderTable([OP_RULES_APPROVE.operation_id])
    expect(screen.getAllByText(/Draft → Approved/)).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Open v3 in Rules ›' })).toHaveAttribute(
      'href',
      '/aid/season/rules?version=3&section=awards&year=2027'
    )
  })

  it("says while an opened line's rows load, and when they can't, with a way to try again", async () => {
    reads[OP_POSTED.operation_id] = { data: undefined, isLoading: true, error: null, refetch }
    const first = renderTable([OP_POSTED.operation_id])
    expect(screen.getByText('Loading its rows…')).toBeInTheDocument()
    first.unmount()
    reads[OP_POSTED.operation_id] = {
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
      refetch,
    }
    renderTable([OP_POSTED.operation_id])
    expect(screen.getByText("Its rows didn't load.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('offers no retry for a 404, which a retry cannot change', () => {
    reads[OP_POSTED.operation_id] = {
      data: undefined,
      isLoading: false,
      error: Object.assign(new Error('missing'), { status: 404 }),
      refetch,
    }
    renderTable([OP_POSTED.operation_id])
    expect(screen.getByText('This operation is not in the log you can read.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull()
  })

  it("keeps the page's as-of on every link it makes", () => {
    const past: AidView = {
      year: 2027,
      asOf: { kind: 'past', date: '2027-03-15', axis: 'campminder' },
    }
    renderTable([OP_SHARE.operation_id, OP_RULES_APPROVE.operation_id], undefined, past)
    // The row block's household link and Open's: both keep the as-of.
    expect(
      screen.getAllByRole('link', { name: 'The Chen Family ›' }).map((a) => a.getAttribute('href'))
    ).toEqual([
      '/aid/households/1000002?year=2027&as_of=2027-03-15',
      '/aid/households/1000002?year=2027&as_of=2027-03-15',
    ])
    expect(screen.getByRole('link', { name: 'Open v3 in Rules ›' })).toHaveAttribute(
      'href',
      '/aid/season/rules?version=3&section=awards&year=2027&as_of=2027-03-15'
    )
  })

  it("lists a row's nested values as a count, never silently (D49)", () => {
    const posted = DETAIL_POSTED.rows[0]
    if (posted === undefined) throw new Error('fixture')
    reads[OP_POSTED.operation_id] = loaded({
      ...DETAIL_POSTED,
      rows: [
        {
          ...posted,
          changes: [...posted.changes, { path: ['snapshot', 'tier'], kind: 'added', after: 3 }],
        },
      ],
    })
    renderTable([OP_POSTED.operation_id])
    expect(screen.getByText('and 1 recorded detail not listed')).toBeInTheDocument()
  })
})

describe('HistoryTable in the box (spec §7.2 C)', () => {
  const inBox = (extra: Partial<React.ComponentProps<typeof HistoryTable>>) =>
    render(
      <MemoryRouter>
        <HistoryTable
          operations={[OP_SHARE, OP_RELEASE, OP_POSTED]}
          open={[]}
          onToggle={onToggle}
          view={VIEW}
          {...extra}
        />
      </MemoryRouter>
    )

  it('fixes its columns at 122 / 214 / 128 / auto / 56', () => {
    inBox({})
    const cols = Array.from(document.querySelectorAll('col')).map((c) => c.className)
    expect(cols).toHaveLength(5)
    expect(cols[0]).toContain('w-[122px]')
    expect(cols[1]).toContain('w-[214px]')
    expect(cols[2]).toContain('w-[128px]')
    expect(cols[4]).toContain('w-[56px]')
  })

  it('puts a page-break row before the row each later page starts at', () => {
    inBox({ starts: [{ page: 2, index: 1 }], perPage: 2, total: 3 })
    const rows = Array.from(document.querySelectorAll('tbody > tr')).map((r) => r.textContent)
    expect(rows[1]).toBe('Page 2 · 3–3')
    expect(document.querySelector('[data-page-start="2"]')).not.toBeNull()
  })

  it('ends with the tail row while more is to come, and not otherwise', () => {
    inBox({ tail: 'Scroll for 51–100' })
    expect(screen.getByText('Scroll for 51–100')).toBeInTheDocument()
  })

  it('sizes the opened row’s line to the box', () => {
    inBox({ open: [OP_RELEASE.operation_id], lineWidth: 640 })
    const line = document.querySelector('td[colspan="5"] > div')
    expect(line).toHaveStyle({ width: '640px' })
  })
})

/** DETAIL_POSTED's 30 rows with who each is about: the server's subject, request id and session (PR 3). */
const namedPosted = (n: number): ApiAidHistoryOperationDetail => ({
  ...DETAIL_POSTED,
  rows: DETAIL_POSTED.rows.slice(0, n).map((r, i) => ({
    ...r,
    household_cm_id: 1000001 + (i % 4),
    household_name: 'The Johnson Family',
    camper_name: 'Emma Johnson',
    request_id: `req${String(i + 1).padStart(12, '0')}`,
    session_cm_id: 1000102,
  })),
})

/** An intake run: three created requests (a compact table, "Ask") and two created payer shares (the rest). */
function intakeDetail(): ApiAidHistoryOperationDetail {
  const id = (i: number) => `req${String(i + 1).padStart(12, '0')}`
  const created = (i: number) =>
    row({
      entity: 'aid_requests',
      entity_id: id(i),
      action: 'create',
      household_cm_id: 1000001 + i,
      household_name: 'The Johnson Family',
      camper_name: 'Emma Johnson',
      request_id: id(i),
      session_cm_id: 1000102,
      after: { ask: '2000' },
      changes: [{ path: ['ask'], kind: 'added', after: '2000' }],
    })
  const share = (i: number) =>
    row({
      entity: 'aid_payer_shares',
      entity_id: `${id(i)}:${String(1000001 + i)}`,
      action: 'create',
      household_cm_id: 1000001 + i,
      household_name: 'The Johnson Family',
      after: { share_pct: '100' },
      changes: [{ path: ['share_pct'], kind: 'added', after: '100' }],
    })
  return {
    year: 2027,
    operation: OP_INTAKE,
    rows: [created(0), created(1), created(2), share(0), share(1)],
  }
}

/** The operation opened, its detail read loaded. */
function openWith(op: ApiAidHistoryOperation, detail: ApiAidHistoryOperationDetail) {
  reads[op.operation_id] = loaded(detail)
  return renderTable([op.operation_id], [op])
}

/** The operation opened, its detail read in `state` (loading, failed, not readable). */
function openWithState(op: ApiAidHistoryOperation, state: Partial<Read>) {
  reads[op.operation_id] = { data: undefined, isLoading: false, error: null, refetch, ...state }
  return renderTable([op.operation_id], [op])
}

/** A 404 as the file's existing "offers no retry for a 404" test builds it. */
const notFound = () => Object.assign(new Error('missing'), { status: 404 })

describe('the opened row (spec §7.2 D)', () => {
  it('splits into three panels: why, What changed, Open', () => {
    openWith(OP_POSTED, namedPosted(30))
    const panels = screen.getByTestId('history-panels')
    expect(within(panels).getByText('What changed')).toBeInTheDocument()
    expect(within(panels).getByText('Open')).toBeInTheDocument()
    expect(within(panels).getByText(/^“March offers”$|^No reason recorded\.$/)).toBeInTheDocument()
    expect(
      within(panels).getByText(`30 rows · operation ${OP_POSTED.operation_id}`)
    ).toBeInTheDocument()
  })

  it('shows 3+ requests as a compact table: 8 rows, then Show all 30, with session names and camper links', async () => {
    openWith(OP_POSTED, namedPosted(30))
    const table = screen.getByTestId('compact-table')
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 8 + 1) // head, 8 rows, foot
    expect(within(table).getByText('All 30, as recorded')).toBeInTheDocument()
    expect(within(table).getAllByText('Session 2')[0]).toBeInTheDocument()
    expect(within(table).getAllByRole('link', { name: 'Emma Johnson' })[0]).toHaveAttribute(
      'href',
      '/aid/households/1000001?year=2027#request-req000000000001'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Show all 30' }))
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 30 + 1)
    expect(within(table).getByText('Total, as recorded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show the first 8' })).toBeInTheDocument()
  })

  it('offers the full list in Requests for 3+ requests', () => {
    openWith(OP_POSTED, namedPosted(30))
    expect(screen.getByRole('link', { name: 'Full list in Requests (30) ›' })).toHaveAttribute(
      'href',
      `/aid/requests?op=${OP_POSTED.operation_id}&year=2027`
    )
  })

  it('reads an intake run: its table, then Also in this run with Show their rows', async () => {
    openWith(OP_INTAKE, intakeDetail())
    expect(screen.getByText('Also in this run')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Show their \d+ rows$/ }))
    expect(screen.getByRole('button', { name: 'Hide their rows' })).toBeInTheDocument()
  })

  it('strikes the old value through in a row block', () => {
    openWith(OP_SHARE, DETAIL_SHARE)
    expect(document.querySelector('[data-history-row] s')).not.toBeNull()
  })

  it("links a row block's camper to the request on its household page (spec §7.2 D, §7.5)", () => {
    openWith(OP_SHARE, {
      ...DETAIL_SHARE,
      rows: DETAIL_SHARE.rows.map((r) => ({ ...r, request_id: 'req000000000009' })),
    })
    const campers = within(screen.getByTestId('history-panels')).getAllByRole('link', {
      name: 'Emma Johnson ›',
    })
    expect(campers.map((a) => a.getAttribute('href'))).toEqual([
      '/aid/households/1000001?year=2027#request-req000000000009',
      '/aid/households/1000002?year=2027#request-req000000000009',
    ])
  })

  it("leaves a row block's camper as plain words when the row names no request", () => {
    openWith(OP_SHARE, DETAIL_SHARE)
    expect(screen.queryByRole('link', { name: /^Emma Johnson/ })).toBeNull()
    expect(
      within(screen.getByTestId('history-panels')).getAllByText(/Emma Johnson/)[0]
    ).toBeInTheDocument()
  })

  it.each([
    ['loading', { isLoading: true }, 'Loading its rows…'],
    ['failed', { isLoading: false, error: new Error('500') }, "Its rows didn't load."],
    [
      'not readable',
      { isLoading: false, error: notFound() },
      'This operation is not in the log you can read.',
    ],
  ])('says the %s state in its words', (_name, state, words) => {
    openWithState(OP_POSTED, state)
    expect(screen.getByText(words, { exact: false })).toBeInTheDocument()
  })

  it('never shows the registrar a rules link', () => {
    openWith(OP_POSTED_LOCKING_REGISTRAR, DETAIL_POSTED)
    expect(screen.queryByRole('link', { name: /in Rules ›$/ })).toBeNull()
  })
})
