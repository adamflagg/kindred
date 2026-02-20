/**
 * Tests for ComparisonSummaryTable component.
 *
 * TDD: Tests written first to define expected rendering behavior.
 */
import { render, screen } from '@testing-library/react'
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
