/**
 * Season › History's table (spec §7.6; D49; history.html B): one line per operation, opening to its
 * rows. The detail read is mocked; the rows are historyFixtures' invented season.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidHistoryOperationDetail } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import {
  DETAIL_POSTED,
  DETAIL_RELEASE,
  DETAIL_RULES_APPROVE,
  DETAIL_SHARE,
  OP_POSTED,
  OP_RELEASE,
  OP_RULES_APPROVE,
  OP_SHARE,
  REGISTRAR_EMAIL,
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
    expect(screen.getByText('Reason: “Family emailed”')).toBeInTheDocument()
    // Each household's row, its record id left out: the row links its household (#18).
    expect(screen.getAllByText('Household share set · payer share · Family emailed')).toHaveLength(
      2
    )
    expect(screen.queryByText(/req000000000009/)).toBeNull()
    expect(screen.getByText('Share pct: 40%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'The Chen Family ›' })).toHaveAttribute(
      'href',
      '/aid/households/1000002?year=2027'
    )
    expect(screen.getByRole('link', { name: 'The Johnson Family ›' })).toHaveAttribute(
      'href',
      '/aid/households/1000001?year=2027'
    )
    expect(screen.getAllByText(/Emma Johnson/)).toHaveLength(2)
  })

  it('shows the first 25 rows, then all of them on asking (a bulk tick is one line, D49)', async () => {
    renderTable([OP_POSTED.operation_id])
    expect(document.querySelectorAll('[data-history-row]')).toHaveLength(25)
    await userEvent.click(screen.getByRole('button', { name: 'Show all 30 rows' }))
    expect(document.querySelectorAll('[data-history-row]')).toHaveLength(30)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
    // A tick's log leaves the receipt out, so nothing nested is left unlisted.
    expect(screen.queryByText(/recorded detail/)).toBeNull()
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
    expect(row).toHaveTextContent('Session: Session 1 → Session 2')
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
    expect(screen.getByRole('link', { name: 'The Chen Family ›' })).toHaveAttribute(
      'href',
      '/aid/households/1000002?year=2027&as_of=2027-03-15'
    )
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
