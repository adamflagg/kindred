/**
 * Tests for ComparisonSummaryTable component.
 *
 * TDD: Tests written first to define expected rendering behavior.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ComparisonSummaryTable } from './ComparisonSummaryTable'

describe('ComparisonSummaryTable', () => {
  it('renders title and year headers', () => {
    render(
      <ComparisonSummaryTable
        title="Gender Breakdown"
        primaryYear={2025}
        compareYear={2024}
        primaryData={[{ name: 'Male', value: 50 }]}
        compareData={[{ name: 'Male', value: 45 }]}
      />
    )

    expect(screen.getByText('Gender Breakdown')).toBeInTheDocument()
    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('Change')).toBeInTheDocument()
  })

  it('renders merged rows with delta values', () => {
    render(
      <ComparisonSummaryTable
        title="Test"
        primaryYear={2025}
        compareYear={2024}
        primaryData={[
          { name: 'Male', value: 50 },
          { name: 'Female', value: 60 },
        ]}
        compareData={[
          { name: 'Male', value: 45 },
          { name: 'Female', value: 70 },
        ]}
      />
    )

    // Row labels
    expect(screen.getByText('Male')).toBeInTheDocument()
    expect(screen.getByText('Female')).toBeInTheDocument()

    // Values
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('60')).toBeInTheDocument()
    expect(screen.getByText('70')).toBeInTheDocument()
  })

  it('renders NEW indicator for items only in primary year', () => {
    render(
      <ComparisonSummaryTable
        title="Test"
        primaryYear={2025}
        compareYear={2024}
        primaryData={[{ name: 'New Grade', value: 10 }]}
        compareData={[]}
      />
    )

    expect(screen.getByText('New Grade')).toBeInTheDocument()
    expect(screen.getByText('NEW')).toBeInTheDocument()
  })

  it('renders GONE indicator for items only in comparison year', () => {
    render(
      <ComparisonSummaryTable
        title="Test"
        primaryYear={2025}
        compareYear={2024}
        primaryData={[]}
        compareData={[{ name: 'Old Grade', value: 5 }]}
      />
    )

    expect(screen.getByText('Old Grade')).toBeInTheDocument()
    expect(screen.getByText('GONE')).toBeInTheDocument()
  })

  it('renders empty state when both datasets are empty', () => {
    render(
      <ComparisonSummaryTable
        title="Test"
        primaryYear={2025}
        compareYear={2024}
        primaryData={[]}
        compareData={[]}
      />
    )

    expect(screen.getByText('No data to compare')).toBeInTheDocument()
  })

  describe('sentiment prop', () => {
    it('should use green for positive change by default', () => {
      const { container } = render(
        <ComparisonSummaryTable
          title="Test"
          primaryYear={2025}
          compareYear={2024}
          primaryData={[{ name: 'Total', value: 50 }]}
          compareData={[{ name: 'Total', value: 40 }]}
        />
      )

      // Positive change cell is the good delta token, forest (#3207 PR 8, ruling #16)
      const changeCells = container.querySelectorAll('td')
      const changeCell = Array.from(changeCells).find((td) => td.textContent.includes('+10'))
      expect(changeCell).toHaveClass('text-forest-700')
    })

    it('should swap colors with sentiment="inverse" — positive becomes red', () => {
      const { container } = render(
        <ComparisonSummaryTable
          title="Cancellations"
          primaryYear={2025}
          compareYear={2024}
          primaryData={[{ name: 'Total', value: 50 }]}
          compareData={[{ name: 'Total', value: 40 }]}
          sentiment="inverse"
        />
      )

      const changeCells = container.querySelectorAll('td')
      const changeCell = Array.from(changeCells).find((td) => td.textContent.includes('+10'))
      expect(changeCell).toHaveClass('text-red-700')
    })

    it('should swap colors with sentiment="inverse" — negative becomes forest', () => {
      const { container } = render(
        <ComparisonSummaryTable
          title="Cancellations"
          primaryYear={2025}
          compareYear={2024}
          primaryData={[{ name: 'Total', value: 30 }]}
          compareData={[{ name: 'Total', value: 40 }]}
          sentiment="inverse"
        />
      )

      const changeCells = container.querySelectorAll('td')
      const changeCell = Array.from(changeCells).find((td) => td.textContent.includes('\u221210'))
      expect(changeCell).toHaveClass('text-forest-700')
    })

    it('should use grey with sentiment="neutral" (ruling #17: New Campers goes grey)', () => {
      const { container } = render(
        <ComparisonSummaryTable
          title="New Campers"
          primaryYear={2025}
          compareYear={2024}
          primaryData={[{ name: 'Total', value: 50 }]}
          compareData={[{ name: 'Total', value: 40 }]}
          sentiment="neutral"
        />
      )

      const changeCells = container.querySelectorAll('td')
      const changeCell = Array.from(changeCells).find((td) => td.textContent.includes('+10'))
      expect(changeCell).toHaveClass('text-muted-foreground')
    })
  })

  describe('compareName display', () => {
    it('should show "(was: X)" when compareName is set via matchKey merge', () => {
      render(
        <ComparisonSummaryTable
          title="Session Enrollment"
          primaryYear={2026}
          compareYear={2025}
          primaryData={[{ name: 'Taste of Camp 1', value: 50, id: '1000001' }]}
          compareData={[{ name: 'Taste of Camp', value: 45, id: '1000001' }]}
          matchKey="id"
        />
      )

      // Primary name should be shown
      expect(screen.getByText('Taste of Camp 1')).toBeInTheDocument()
      // Should show the compare year's different name
      expect(screen.getByText('(was: Taste of Camp)')).toBeInTheDocument()
    })

    it('should NOT show "(was: X)" when names are the same', () => {
      render(
        <ComparisonSummaryTable
          title="Session Enrollment"
          primaryYear={2026}
          compareYear={2025}
          primaryData={[{ name: 'Session 2', value: 80, id: '1000002' }]}
          compareData={[{ name: 'Session 2', value: 75, id: '1000002' }]}
          matchKey="id"
        />
      )

      expect(screen.getByText('Session 2')).toBeInTheDocument()
      expect(screen.queryByText(/was:/)).not.toBeInTheDocument()
    })
  })

  describe('categoryLabel prop', () => {
    it('renders "Category" as default column header', () => {
      render(
        <ComparisonSummaryTable
          title="Test Table"
          primaryYear={2026}
          compareYear={2025}
          primaryData={[{ name: 'Item A', value: 10 }]}
          compareData={[{ name: 'Item A', value: 8 }]}
        />
      )

      expect(screen.getByText('Category')).toBeInTheDocument()
    })

    it('renders custom categoryLabel as column header', () => {
      render(
        <ComparisonSummaryTable
          title="Session Enrollment Comparison"
          primaryYear={2026}
          compareYear={2025}
          primaryData={[{ name: 'Session 2', value: 100 }]}
          compareData={[{ name: 'Session 2', value: 90 }]}
          categoryLabel="Session"
        />
      )

      expect(screen.getByText('Session')).toBeInTheDocument()
      expect(screen.queryByText('Category')).not.toBeInTheDocument()
    })
  })

  describe('NEW/GONE (0) annotations removed', () => {
    it('does NOT render (0) annotation on NEW rows', () => {
      render(
        <ComparisonSummaryTable
          title="Test"
          primaryYear={2026}
          compareYear={2025}
          primaryData={[{ name: 'New Item', value: 50 }]}
          compareData={[]}
        />
      )

      expect(screen.getByText('NEW')).toBeInTheDocument()
      expect(screen.queryByText('(0)')).not.toBeInTheDocument()
    })

    it('does NOT render (0) annotation on GONE rows', () => {
      render(
        <ComparisonSummaryTable
          title="Test"
          primaryYear={2026}
          compareYear={2025}
          primaryData={[]}
          compareData={[{ name: 'Gone Item', value: 50 }]}
        />
      )

      expect(screen.getByText('GONE')).toBeInTheDocument()
      expect(screen.queryByText('(0)')).not.toBeInTheDocument()
    })
  })

  describe('aliasMap prop', () => {
    it('passes aliasMap to merge logic so aliased names are matched', () => {
      const aliasMap = { 'Old Name': 'New Name' }

      render(
        <ComparisonSummaryTable
          title="Test"
          primaryYear={2026}
          compareYear={2025}
          primaryData={[{ name: 'New Name', value: 100 }]}
          compareData={[{ name: 'Old Name', value: 80 }]}
          aliasMap={aliasMap}
        />
      )

      // Should merge the rows (not show NEW/GONE)
      expect(screen.queryByText('NEW')).not.toBeInTheDocument()
      expect(screen.queryByText('GONE')).not.toBeInTheDocument()
      // Should show the merged row with the primary name and "(was: Old Name)"
      expect(screen.getByText('New Name')).toBeInTheDocument()
      expect(screen.getByText('(was: Old Name)')).toBeInTheDocument()
    })
  })

  it('merges by matchKey when names differ between years', () => {
    render(
      <ComparisonSummaryTable
        title="Session Enrollment"
        primaryYear={2026}
        compareYear={2025}
        primaryData={[
          { name: '2026 Taste of Camp 1', value: 50, id: '1000001' },
          { name: '2026 Session 2', value: 80, id: '1000002' },
        ]}
        compareData={[
          { name: '2025 Taste of Camp', value: 45, id: '1000001' },
          { name: '2025 Session 2', value: 75, id: '1000002' },
        ]}
        matchKey="id"
      />
    )

    // Should display primary year's name
    expect(screen.getByText('2026 Taste of Camp 1')).toBeInTheDocument()
    expect(screen.getByText('2026 Session 2')).toBeInTheDocument()
    // Should NOT show compare year's different name as a separate row
    expect(screen.queryByText('2025 Taste of Camp')).not.toBeInTheDocument()
    // Values should be present
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
  })
})

describe('ComparisonSummaryTable sortable (#3207 PR 10)', () => {
  const props = {
    title: 'Session Enrollment Comparison',
    primaryYear: 2026,
    compareYear: 2025,
    primaryData: [
      { name: 'Session A', value: 10 },
      { name: 'Session B', value: 30 },
      { name: 'Session C', value: 20 },
    ],
    compareData: [
      { name: 'Session A', value: 12 },
      { name: 'Session B', value: 25 },
      { name: 'Session C', value: 20 },
    ],
  }
  const names = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.querySelector('td')?.textContent)

  it('sorts a number column high to low, then flips', () => {
    render(<ComparisonSummaryTable {...props} sortable />)
    expect(names()).toEqual(['Session A', 'Session B', 'Session C'])
    fireEvent.click(screen.getByRole('button', { name: /^2026/ }))
    expect(names()).toEqual(['Session B', 'Session C', 'Session A'])
    fireEvent.click(screen.getByRole('button', { name: /^2026/ }))
    expect(names()).toEqual(['Session A', 'Session C', 'Session B'])
  })

  it('adds Copy and Download CSV only when sortable', () => {
    const { unmount } = render(<ComparisonSummaryTable {...props} sortable />)
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument()
    unmount()
    render(<ComparisonSummaryTable {...props} />)
    expect(screen.queryByRole('button', { name: /download csv/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^2026/ })).not.toBeInTheDocument()
  })
})

describe('ComparisonSummaryTable footer (#2898)', () => {
  it('renders the footer under the table', () => {
    render(
      <ComparisonSummaryTable
        title="Gender Comparison"
        primaryYear={2018}
        compareYear={2017}
        primaryData={[{ name: 'Girl/woman', value: 50 }]}
        compareData={[{ name: 'Girl/woman', value: 45 }]}
        footer={<p>a note line</p>}
      />
    )
    expect(screen.getByText('a note line')).toBeInTheDocument()
  })

  it('shows a colour swatch per row when given a colour map', () => {
    const { container } = render(
      <ComparisonSummaryTable
        title="Gender Comparison"
        primaryYear={2018}
        compareYear={2017}
        primaryData={[{ name: 'Girl/woman', value: 50 }]}
        compareData={[{ name: 'Girl/woman', value: 45 }]}
        colorMap={{ 'Girl/woman': '#d9266b' }}
      />
    )
    const swatch = [...container.querySelectorAll<HTMLElement>('[style]')].find(
      (el) => el.style.backgroundColor !== ''
    )
    expect(swatch?.style.backgroundColor).toBe('rgb(217, 38, 107)')
  })
})
