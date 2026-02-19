/**
 * TDD tests for SessionBunkHeatmap component.
 *
 * Tests written FIRST before implementation.
 * The heatmap renders split sub-tables by gender area (Boys, Girls, AG).
 * Sessions sorted by date when sessionDateLookup provided.
 * Cells show retention percentages, color-coded by rate.
 * Missing session-bunk combos show "—".
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SessionBunkHeatmap } from './SessionBunkHeatmap'
import type { RetentionBySessionBunk } from '../../types/metrics'
import type { SessionDateLookup } from '../../utils/sessionUtils'

const sampleData: RetentionBySessionBunk[] = [
  { session: 'Session 1', bunk: 'B-1', base_count: 10, returned_count: 8, retention_rate: 0.8 },
  { session: 'Session 1', bunk: 'B-2', base_count: 12, returned_count: 3, retention_rate: 0.25 },
  { session: 'Session 1', bunk: 'G-1', base_count: 10, returned_count: 5, retention_rate: 0.5 },
  { session: 'Session 2', bunk: 'B-1', base_count: 8, returned_count: 6, retention_rate: 0.75 },
  { session: 'Session 2', bunk: 'G-2', base_count: 9, returned_count: 1, retention_rate: 0.111 },
]

/**
 * Helper: get all tables within a specific section heading.
 * Sections are identified by their heading text (e.g., "Boys Cabins").
 */
function getTableInSection(sectionHeading: string) {
  const heading = screen.getByText(sectionHeading)
  // The table is the next sibling element after the heading within the section wrapper
  const section = heading.closest('[data-section]') as HTMLElement
  return within(section).getByRole('table')
}

function getRowHeaders(table: HTMLElement): string[] {
  const rows = within(table).getAllByRole('row')
  return rows.slice(1).map((row) => within(row).getByRole('rowheader').textContent!)
}

function getColumnHeaders(table: HTMLElement): string[] {
  const headerRow = within(table).getAllByRole('row')[0]!
  return within(headerRow)
    .getAllByRole('columnheader')
    .map((th) => th.textContent!)
}

describe('SessionBunkHeatmap', () => {
  it('renders session names as row headers in each section', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    const boysTable = getTableInSection('Boys Cabins')
    const rowHeaders = getRowHeaders(boysTable)
    expect(rowHeaders).toContain('Session 1')
    expect(rowHeaders).toContain('Session 2')
  })

  it('renders bunk names as column headers within correct sections', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    const boysTable = getTableInSection('Boys Cabins')
    const boysHeaders = getColumnHeaders(boysTable)
    expect(boysHeaders).toContain('B-1')
    expect(boysHeaders).toContain('B-2')
    expect(boysHeaders).not.toContain('G-1')
    expect(boysHeaders).not.toContain('G-2')

    const girlsTable = getTableInSection('Girls Cabins')
    const girlsHeaders = getColumnHeaders(girlsTable)
    expect(girlsHeaders).toContain('G-1')
    expect(girlsHeaders).toContain('G-2')
    expect(girlsHeaders).not.toContain('B-1')
  })

  it('sorts bunk columns naturally (numeric)', () => {
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 1', bunk: 'B-10', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-2', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
    ]
    render(<SessionBunkHeatmap data={data} />)

    const boysTable = getTableInSection('Boys Cabins')
    const bunkHeaders = getColumnHeaders(boysTable).filter((h) => h.startsWith('B-'))
    expect(bunkHeaders).toEqual(['B-1', 'B-2', 'B-10'])
  })

  it('shows retention percentages in correct cells', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    const boysTable = getTableInSection('Boys Cabins')
    const rows = within(boysTable).getAllByRole('row')

    // Session 1 row in boys table: B-1=80%, B-2=25%
    const session1Row = rows.find(
      (row) => within(row).queryByRole('rowheader')?.textContent === 'Session 1',
    )
    expect(session1Row).toBeDefined()

    const session1Cells = within(session1Row!).getAllByRole('cell')
    const session1Text = session1Cells.map((c) => c.textContent)
    expect(session1Text).toContain('80%')
    expect(session1Text).toContain('25%')
  })

  it('shows "—" for missing session-bunk combos', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    const girlsTable = getTableInSection('Girls Cabins')
    const rows = within(girlsTable).getAllByRole('row')

    // Session 1 doesn't have G-2, Session 2 doesn't have G-1
    const session1Row = rows.find(
      (row) => within(row).queryByRole('rowheader')?.textContent === 'Session 1',
    )
    expect(session1Row).toBeDefined()
    const session1Cells = within(session1Row!).getAllByRole('cell')
    expect(session1Cells.map((c) => c.textContent)).toContain('—')

    const session2Row = rows.find(
      (row) => within(row).queryByRole('rowheader')?.textContent === 'Session 2',
    )
    expect(session2Row).toBeDefined()
    const session2Cells = within(session2Row!).getAllByRole('cell')
    expect(session2Cells.map((c) => c.textContent)).toContain('—')
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

  it('sorts sessions naturally by default', () => {
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 2', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 2a', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
    ]
    render(<SessionBunkHeatmap data={data} />)

    const boysTable = getTableInSection('Boys Cabins')
    const sessionNames = getRowHeaders(boysTable)
    expect(sessionNames).toEqual(['Session 1', 'Session 2', 'Session 2a'])
  })

  // ============================================================================
  // New tests: date-based sorting
  // ============================================================================

  it('sorts sessions by date when sessionDateLookup provided', () => {
    // Session 2a starts before Session 2 in this mock (date-wise)
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 1', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 2', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 2a', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
    ]
    const dateLookup: SessionDateLookup = {
      'Session 1': '2025-06-15',
      'Session 2': '2025-07-20',
      'Session 2a': '2025-07-10', // Starts before Session 2
    }
    render(<SessionBunkHeatmap data={data} sessionDateLookup={dateLookup} />)

    const boysTable = getTableInSection('Boys Cabins')
    const sessionNames = getRowHeaders(boysTable)
    expect(sessionNames).toEqual(['Session 1', 'Session 2a', 'Session 2'])
  })

  it('falls back to name-based sort when sessionDateLookup is empty', () => {
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 2', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 2a', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
    ]
    render(<SessionBunkHeatmap data={data} sessionDateLookup={{}} />)

    const boysTable = getTableInSection('Boys Cabins')
    const sessionNames = getRowHeaders(boysTable)
    expect(sessionNames).toEqual(['Session 1', 'Session 2', 'Session 2a'])
  })

  // ============================================================================
  // New tests: gender area splitting
  // ============================================================================

  it('splits bunks into Boys, Girls, and AG sections', () => {
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 1', bunk: 'B-1', base_count: 10, returned_count: 8, retention_rate: 0.8 },
      { session: 'Session 1', bunk: 'G-1', base_count: 10, returned_count: 5, retention_rate: 0.5 },
      { session: 'Session 1', bunk: 'AG-8', base_count: 10, returned_count: 7, retention_rate: 0.7 },
    ]
    render(<SessionBunkHeatmap data={data} />)

    // All three section headings should be present
    expect(screen.getByText('Boys Cabins')).toBeInTheDocument()
    expect(screen.getByText('Girls Cabins')).toBeInTheDocument()
    expect(screen.getByText('All-Gender Cabins')).toBeInTheDocument()

    // Three tables, one per section
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(3)

    // Each table has only its bunks
    const boysTable = getTableInSection('Boys Cabins')
    const boysHeaders = getColumnHeaders(boysTable)
    expect(boysHeaders).toContain('B-1')
    expect(boysHeaders).not.toContain('G-1')
    expect(boysHeaders).not.toContain('AG-8')

    const girlsTable = getTableInSection('Girls Cabins')
    const girlsHeaders = getColumnHeaders(girlsTable)
    expect(girlsHeaders).toContain('G-1')

    const agTable = getTableInSection('All-Gender Cabins')
    const agHeaders = getColumnHeaders(agTable)
    expect(agHeaders).toContain('AG-8')
  })

  it('omits AG section when no AG bunks', () => {
    // sampleData only has B-* and G-* bunks
    render(<SessionBunkHeatmap data={sampleData} />)

    expect(screen.getByText('Boys Cabins')).toBeInTheDocument()
    expect(screen.getByText('Girls Cabins')).toBeInTheDocument()
    expect(screen.queryByText('All-Gender Cabins')).not.toBeInTheDocument()
  })

  it('renders only one section when all bunks same prefix', () => {
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 1', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-2', base_count: 5, returned_count: 4, retention_rate: 0.8 },
      { session: 'Session 2', bunk: 'B-1', base_count: 5, returned_count: 2, retention_rate: 0.4 },
    ]
    render(<SessionBunkHeatmap data={data} />)

    expect(screen.getByText('Boys Cabins')).toBeInTheDocument()
    expect(screen.queryByText('Girls Cabins')).not.toBeInTheDocument()
    expect(screen.queryByText('All-Gender Cabins')).not.toBeInTheDocument()

    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(1)
  })

  it('shows all sessions in every sub-table', () => {
    // Session 1 has boys and girls bunks, Session 2 only has boys
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 1', bunk: 'B-1', base_count: 10, returned_count: 8, retention_rate: 0.8 },
      { session: 'Session 1', bunk: 'G-1', base_count: 10, returned_count: 5, retention_rate: 0.5 },
      { session: 'Session 2', bunk: 'B-1', base_count: 8, returned_count: 6, retention_rate: 0.75 },
    ]
    render(<SessionBunkHeatmap data={data} />)

    // Girls table should show both sessions, even though Session 2 has no girls data
    const girlsTable = getTableInSection('Girls Cabins')
    const girlsRowHeaders = getRowHeaders(girlsTable)
    expect(girlsRowHeaders).toContain('Session 1')
    expect(girlsRowHeaders).toContain('Session 2')

    // Session 2 in girls table should show dashes
    const girlsRows = within(girlsTable).getAllByRole('row')
    const session2Row = girlsRows.find(
      (row) => within(row).queryByRole('rowheader')?.textContent === 'Session 2',
    )
    expect(session2Row).toBeDefined()
    const cells = within(session2Row!).getAllByRole('cell')
    expect(cells.map((c) => c.textContent)).toEqual(['—'])
  })
})
