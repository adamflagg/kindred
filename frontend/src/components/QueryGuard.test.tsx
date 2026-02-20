/**
 * Tests for QueryGuard - TDD tests written first.
 *
 * QueryGuard is the app-wide re-export of MetricsQueryGuard.
 * It handles loading/error/empty states for any data-fetching component.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { QueryGuard } from './QueryGuard'

describe('QueryGuard', () => {
  it('shows loading spinner when isLoading is true', () => {
    render(
      <QueryGuard isLoading={true} error={null} data={undefined} label="sessions">
        {() => <div>Content</div>}
      </QueryGuard>
    )

    expect(screen.getByText('Loading sessions data...')).toBeInTheDocument()
    expect(screen.queryByText('Content')).not.toBeInTheDocument()
  })

  it('shows error message when error is present', () => {
    const error = new Error('Connection refused')
    render(
      <QueryGuard isLoading={false} error={error} data={undefined} label="campers">
        {() => <div>Content</div>}
      </QueryGuard>
    )

    expect(
      screen.getByText('Failed to load campers data: Connection refused')
    ).toBeInTheDocument()
    expect(screen.queryByText('Content')).not.toBeInTheDocument()
  })

  it('shows default empty message when data is undefined', () => {
    render(
      <QueryGuard isLoading={false} error={null} data={undefined} label="sessions">
        {() => <div>Content</div>}
      </QueryGuard>
    )

    expect(screen.getByText('No data available')).toBeInTheDocument()
    expect(screen.queryByText('Content')).not.toBeInTheDocument()
  })

  it('renders children with data when data is available', () => {
    const data = { sessions: ['Session 1', 'Session 2'] }
    render(
      <QueryGuard isLoading={false} error={null} data={data} label="sessions">
        {(d) => <div>Count: {d.sessions.length}</div>}
      </QueryGuard>
    )

    expect(screen.getByText('Count: 2')).toBeInTheDocument()
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()
  })

  it('uses custom empty message when provided', () => {
    render(
      <QueryGuard
        isLoading={false}
        error={null}
        data={undefined}
        label="campers"
        emptyMessage="No campers enrolled yet"
      >
        {() => <div>Content</div>}
      </QueryGuard>
    )

    expect(screen.getByText('No campers enrolled yet')).toBeInTheDocument()
  })

  it('prioritizes loading over error', () => {
    const error = new Error('Some error')
    render(
      <QueryGuard isLoading={true} error={error} data={undefined} label="test">
        {() => <div>Content</div>}
      </QueryGuard>
    )

    expect(screen.getByText('Loading test data...')).toBeInTheDocument()
    expect(screen.queryByText(/Failed/)).not.toBeInTheDocument()
  })
})
