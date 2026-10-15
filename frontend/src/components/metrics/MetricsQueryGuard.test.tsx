/**
 * Tests for MetricsQueryGuard - TDD tests written first.
 *
 * MetricsQueryGuard handles loading/error/empty states for metrics pages,
 * rendering children only when data is available.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
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

describe('MetricsQueryGuard — Try again and the busy cue (D-UNCOVERED, #3207)', () => {
  it('offers "Try again" on an error and calls onRetry', () => {
    const onRetry = vi.fn()
    render(
      <MetricsQueryGuard
        isLoading={false}
        error={new Error('timeout')}
        data={undefined}
        label="cancellations"
        onRetry={onRetry}
      >
        {() => <p>content</p>}
      </MetricsQueryGuard>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows no button when there is nothing to retry with', () => {
    render(
      <MetricsQueryGuard isLoading={false} error={new Error('x')} data={undefined} label="waitlist">
        {() => <p>content</p>}
      </MetricsQueryGuard>
    )
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('dims the old numbers, makes them inert and says what is loading while placeholder data shows', () => {
    render(
      <MetricsQueryGuard
        isLoading={false}
        error={null}
        data={{ n: 1 }}
        label="cancellations"
        isPlaceholderData
        loadingLabel="2025"
      >
        {() => <p>old numbers</p>}
      </MetricsQueryGuard>
    )
    expect(screen.getByText('Loading 2025…')).toBeInTheDocument()
    const region = screen.getByText('old numbers').closest('[inert]')
    expect(region).not.toBeNull()
    expect(region?.className).toContain('opacity-')
  })

  it('shows the numbers plainly once the new data lands', () => {
    render(
      <MetricsQueryGuard
        isLoading={false}
        error={null}
        data={{ n: 1 }}
        label="x"
        loadingLabel="2025"
      >
        {() => <p>new numbers</p>}
      </MetricsQueryGuard>
    )
    expect(screen.queryByText(/Loading 2025/)).toBeNull()
    expect(screen.getByText('new numbers').closest('[inert]')).toBeNull()
  })
})
