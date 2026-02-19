/**
 * Tests for MetricsQueryGuard - TDD tests written first.
 *
 * MetricsQueryGuard handles loading/error/empty states for metrics pages,
 * rendering children only when data is available.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MetricsQueryGuard } from './MetricsQueryGuard'

describe('MetricsQueryGuard', () => {
  it('shows loading spinner when isLoading is true', () => {
    render(
      <MetricsQueryGuard isLoading={true} error={null} data={undefined} label="registration">
        {() => <div>Content</div>}
      </MetricsQueryGuard>
    )

    expect(screen.getByText('Loading registration data...')).toBeInTheDocument()
    expect(screen.queryByText('Content')).not.toBeInTheDocument()
  })

  it('shows error message when error is present', () => {
    const error = new Error('Network failure')
    render(
      <MetricsQueryGuard isLoading={false} error={error} data={undefined} label="retention">
        {() => <div>Content</div>}
      </MetricsQueryGuard>
    )

    expect(screen.getByText('Failed to load retention data: Network failure')).toBeInTheDocument()
    expect(screen.queryByText('Content')).not.toBeInTheDocument()
  })

  it('shows empty message when data is undefined', () => {
    render(
      <MetricsQueryGuard isLoading={false} error={null} data={undefined} label="waitlist">
        {() => <div>Content</div>}
      </MetricsQueryGuard>
    )

    expect(screen.getByText('No data available')).toBeInTheDocument()
    expect(screen.queryByText('Content')).not.toBeInTheDocument()
  })

  it('renders children with data when data is available', () => {
    const data = { total: 42 }
    render(
      <MetricsQueryGuard isLoading={false} error={null} data={data} label="registration">
        {(d) => <div>Total: {d.total}</div>}
      </MetricsQueryGuard>
    )

    expect(screen.getByText('Total: 42')).toBeInTheDocument()
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()
  })

  it('uses custom empty message when provided', () => {
    render(
      <MetricsQueryGuard
        isLoading={false}
        error={null}
        data={undefined}
        label="trends"
        emptyMessage="No historical data available"
      >
        {() => <div>Content</div>}
      </MetricsQueryGuard>
    )

    expect(screen.getByText('No historical data available')).toBeInTheDocument()
  })

  it('prioritizes loading over error', () => {
    const error = new Error('Some error')
    render(
      <MetricsQueryGuard isLoading={true} error={error} data={undefined} label="test">
        {() => <div>Content</div>}
      </MetricsQueryGuard>
    )

    expect(screen.getByText('Loading test data...')).toBeInTheDocument()
    expect(screen.queryByText(/Failed/)).not.toBeInTheDocument()
  })
})
