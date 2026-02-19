/**
 * TDD tests for SessionBunkHeatmap component.
 *
 * Tests written FIRST before implementation.
 * The heatmap renders a 2D grid table with sessions as rows and bunks as columns.
 * Cells show retention percentages, color-coded by rate.
 * Missing session-bunk combos show "—".
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SessionBunkHeatmap } from './SessionBunkHeatmap'
import type { RetentionBySessionBunk } from '../../types/metrics'

const sampleData: RetentionBySessionBunk[] = [
  { session: 'Session 1', bunk: 'B-1', base_count: 10, returned_count: 8, retention_rate: 0.8 },
  { session: 'Session 1', bunk: 'B-2', base_count: 12, returned_count: 3, retention_rate: 0.25 },
  { session: 'Session 1', bunk: 'G-1', base_count: 10, returned_count: 5, retention_rate: 0.5 },
  { session: 'Session 2', bunk: 'B-1', base_count: 8, returned_count: 6, retention_rate: 0.75 },
  { session: 'Session 2', bunk: 'G-2', base_count: 9, returned_count: 1, retention_rate: 0.111 },
]

describe('SessionBunkHeatmap', () => {
  it('renders session names as row headers', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    // Sessions should appear as row headers in the table
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')

    // First row is header with bunk columns, remaining rows are sessions
    // Row headers should contain session names
    const rowHeaders = rows.slice(1).map((row) => within(row).getByRole('rowheader').textContent)
    expect(rowHeaders).toContain('Session 1')
    expect(rowHeaders).toContain('Session 2')
  })

  it('renders bunk names as column headers', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    const table = screen.getByRole('table')
    const headerRow = within(table).getAllByRole('row')[0]!
    const columnHeaders = within(headerRow)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)

    // Should have all unique bunks as columns (naturally sorted)
    expect(columnHeaders).toContain('B-1')
    expect(columnHeaders).toContain('B-2')
    expect(columnHeaders).toContain('G-1')
    expect(columnHeaders).toContain('G-2')
  })

  it('sorts bunk columns naturally (numeric)', () => {
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 1', bunk: 'B-10', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-2', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
    ]
    render(<SessionBunkHeatmap data={data} />)

    const table = screen.getByRole('table')
    const headerRow = within(table).getAllByRole('row')[0]!
    const columnHeaders = within(headerRow)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)

    // Filter to just bunk names (skip first empty corner header)
    const bunkHeaders = columnHeaders.filter((h) => h && h.startsWith('B-'))
    expect(bunkHeaders).toEqual(['B-1', 'B-2', 'B-10'])
  })

  it('shows retention percentages in correct cells', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')

    // Session 1 row: B-1=80%, B-2=25%, G-1=50%
    const session1Row = rows.find(
      (row) => within(row).queryByRole('rowheader')?.textContent === 'Session 1',
    )
    expect(session1Row).toBeDefined()

    const session1Cells = within(session1Row!).getAllByRole('cell')
    const session1Text = session1Cells.map((c) => c.textContent)
    expect(session1Text).toContain('80%')
    expect(session1Text).toContain('25%')
    expect(session1Text).toContain('50%')
  })

  it('shows "—" for missing session-bunk combos', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')

    // Session 2 doesn't have B-2 or G-1, so those cells should show "—"
    const session2Row = rows.find(
      (row) => within(row).queryByRole('rowheader')?.textContent === 'Session 2',
    )
    expect(session2Row).toBeDefined()

    const session2Cells = within(session2Row!).getAllByRole('cell')
    const session2Text = session2Cells.map((c) => c.textContent)
    expect(session2Text.filter((t) => t === '—').length).toBe(2) // B-2 and G-1 missing
  })

  it('renders tooltip with counts via title attribute', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    // Tooltip via title attribute: "X of Y returned (Z%)"
    expect(screen.getByTitle('8 of 10 returned (80%)')).toBeInTheDocument()
    expect(screen.getByTitle('3 of 12 returned (25%)')).toBeInTheDocument()
  })

  it('renders nothing when data is empty', () => {
    const { container } = render(<SessionBunkHeatmap data={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a legend', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    expect(screen.getByText(/high/i)).toBeInTheDocument()
    expect(screen.getByText(/low/i)).toBeInTheDocument()
  })

  it('sorts sessions naturally', () => {
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 2', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 2a', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
    ]
    render(<SessionBunkHeatmap data={data} />)

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    const sessionNames = rows
      .slice(1)
      .map((row) => within(row).getByRole('rowheader').textContent)

    expect(sessionNames).toEqual(['Session 1', 'Session 2', 'Session 2a'])
  })
})
