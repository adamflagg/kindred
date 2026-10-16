/**
 * A row an action moved out of the page's filter stays in view (design-language rule 22): after Add a Request…
 * a Needs a look row no longer needs a look, but it stays where it was, opened, so staff see what the action did.
 * It is display only, as the search's kept row is: the totals, the counts, the checks and the CSV are of the rows
 * that match. It leaves when the filter changes (`useKeptRows`' scope) or the page is reloaded. Fictional rows.
 */
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'
import { keepInView } from './table'
import { useKeptRows } from './useKeptRows'

const downloadSpy = vi.fn()
vi.mock('../../../utils/csvExport', async (importActual) => ({
  ...(await importActual<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => downloadSpy(...args),
}))
beforeEach(() => downloadSpy.mockClear())

interface Row {
  id: string
  camper: string
  aid: number
  needsLook: boolean
}
const ALL: Row[] = [
  { id: 'a', camper: 'Emma Johnson', aid: 100, needsLook: false },
  { id: 'b', camper: 'Olivia Chen', aid: 200, needsLook: true },
  { id: 'c', camper: 'Riley Sam', aid: 400, needsLook: true },
]
const key = (r: Row) => r.id
const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'camper', header: 'Camper', width: 150, searchable: true, value: (r) => r.camper },
  {
    key: 'aid',
    header: 'Aid',
    width: 100,
    value: (r) => r.aid,
    total: (rows) => rows.reduce((s, r) => s + r.aid, 0),
  },
]

describe('keepInView', () => {
  it('keeps the rows the filter matches plus the kept ones, in the order they came (in place)', () => {
    const shown = keepInView(ALL, (r) => r.needsLook, new Set(['a']), key)
    expect(shown.map(key)).toEqual(['a', 'b', 'c'])
  })

  it('drops a row the filter does not match once nothing keeps it', () => {
    expect(keepInView(ALL, (r) => r.needsLook, new Set(), key).map(key)).toEqual(['b', 'c'])
  })
})

function renderTable(extra: Partial<Parameters<typeof AidTable<Row>>[0]> = {}) {
  const kept = new Set(['a'])
  return render(
    <MemoryRouter>
      <AidTable<Row>
        rows={keepInView(ALL, (r) => r.needsLook, kept, key)}
        keptKeys={kept}
        columns={COLUMNS}
        rowKey={key}
        csvFilename="x.csv"
        footerLabel={(rows) => `${String(rows.length)} rows`}
        {...extra}
      />
    </MemoryRouter>
  )
}
const rowOf = (k: string) => document.querySelector(`tr[data-row-key="${k}"]`)

describe('AidTable keptKeys', () => {
  it('draws the kept row in place, marked data-kept', () => {
    renderTable()
    const keys = [...document.querySelectorAll('tbody tr[data-row-key]')].map((tr) =>
      tr.getAttribute('data-row-key')
    )
    expect(keys).toEqual(['a', 'b', 'c'])
    expect(rowOf('a')).toHaveAttribute('data-kept', 'true')
    expect(rowOf('b')).not.toHaveAttribute('data-kept')
  })

  it('leaves it out of the footer: the label and the totals count the matching rows only', () => {
    renderTable()
    const foot = document.querySelector('tfoot') as HTMLElement
    expect(foot).toHaveTextContent('2 rows')
    expect(foot).toHaveTextContent('$600')
  })

  it('leaves it out of the CSV', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: /Download CSV/ }))
    const [content] = downloadSpy.mock.calls[0] as [string, string]
    expect(content).toContain('Olivia Chen')
    expect(content).not.toContain('Emma Johnson')
  })

  it('gives it no checkbox and Select all does not take it', () => {
    const onSelectedChange = vi.fn()
    renderTable({ selected: new Set(), onSelectedChange })
    expect(within(rowOf('a') as HTMLElement).queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect([...(onSelectedChange.mock.calls[0]?.[0] as Set<string>)]).toEqual(['b', 'c'])
  })

  it('stays opened (amber) when the page highlights it', () => {
    renderTable({
      highlighted: 'a',
      onHighlight: () => {},
      renderDetail: () => <span>Added a TWR request</span>,
    })
    expect(rowOf('a')).toHaveAttribute('data-highlighted', 'true')
    expect(screen.getByText('Added a TWR request')).toBeInTheDocument()
  })

  it('is still searched: a search it does not match hides it, unless it is the opened row', () => {
    const { unmount } = renderTable()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Riley' } })
    expect(rowOf('a')).toBeNull()
    unmount()
    renderTable({ highlighted: 'a', onHighlight: () => {} })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Riley' } })
    expect(rowOf('a')).not.toBeNull()
  })

  it('is never reported as a match to the page (onMatchingChange)', () => {
    const onMatchingChange = vi.fn()
    renderTable({ onMatchingChange })
    const last = onMatchingChange.mock.calls.at(-1)?.[0] as Set<string>
    expect([...last].sort()).toEqual(['b', 'c'])
  })
})

describe('useKeptRows', () => {
  it('keeps what an action changed until the scope (the filter) changes', () => {
    const { result, rerender } = renderHook(({ scope }) => useKeptRows(scope), {
      initialProps: { scope: 'look' },
    })
    expect(result.current.kept.size).toBe(0)
    act(() => result.current.keep('a'))
    act(() => result.current.keep('b'))
    expect([...result.current.kept]).toEqual(['a', 'b'])
    rerender({ scope: 'look' })
    expect(result.current.kept.has('a')).toBe(true)
    rerender({ scope: 'all' })
    expect(result.current.kept.size).toBe(0)
  })

  it('hands back the same set between renders while nothing changed (a stable memo input)', () => {
    const { result, rerender } = renderHook(() => useKeptRows('look'))
    const first = result.current.kept
    rerender()
    expect(result.current.kept).toBe(first)
  })
})
