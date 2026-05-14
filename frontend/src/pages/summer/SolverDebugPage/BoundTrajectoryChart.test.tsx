import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BoundTrajectoryChart } from './BoundTrajectoryChart'

describe('BoundTrajectoryChart', () => {
  it('renders an empty state when both trajectories are empty', () => {
    render(<BoundTrajectoryChart objectiveTrajectory={[]} boundTrajectory={[]} />)
    expect(screen.getByText(/no trajectory data/i)).toBeInTheDocument()
  })

  it('renders two polylines when both trajectories have points', () => {
    const { container } = render(
      <BoundTrajectoryChart
        objectiveTrajectory={[
          { t: 1, objective: 100, bound: 200 },
          { t: 5, objective: 150, bound: 180 },
        ]}
        boundTrajectory={[
          { t: 0.5, bound: 250 },
          { t: 5, bound: 180 },
        ]}
      />
    )
    expect(container.querySelectorAll('polyline')).toHaveLength(2)
  })

  it('renders only the bound polyline when the objective trajectory is empty', () => {
    const { container } = render(
      <BoundTrajectoryChart
        objectiveTrajectory={[]}
        boundTrajectory={[
          { t: 0.5, bound: 250 },
          { t: 5, bound: 180 },
        ]}
      />
    )
    expect(container.querySelectorAll('polyline')).toHaveLength(1)
  })

  it('renders only the objective polyline when the bound trajectory is empty', () => {
    const { container } = render(
      <BoundTrajectoryChart
        objectiveTrajectory={[
          { t: 1, objective: 100, bound: 200 },
          { t: 5, objective: 150, bound: 180 },
        ]}
        boundTrajectory={[]}
      />
    )
    expect(container.querySelectorAll('polyline')).toHaveLength(1)
  })

  it('renders a visible marker for a single-point objective trajectory', () => {
    // A 1-point polyline draws no segment; without a dot marker a solve that
    // found exactly one solution would render a blank chart.
    const { container } = render(
      <BoundTrajectoryChart
        objectiveTrajectory={[{ t: 3, objective: 100, bound: 200 }]}
        boundTrajectory={[]}
      />
    )
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(1)
  })

  it('renders a visible marker for a single-point bound trajectory', () => {
    const { container } = render(
      <BoundTrajectoryChart objectiveTrajectory={[]} boundTrajectory={[{ t: 3, bound: 200 }]} />
    )
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(1)
  })
})
