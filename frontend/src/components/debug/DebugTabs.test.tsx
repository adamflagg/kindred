import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { DebugTabs } from './DebugTabs'

describe('DebugTabs', () => {
  it('renders all four tabs', () => {
    render(
      <MemoryRouter initialEntries={['/summer/debug/parse-analysis']}>
        <DebugTabs />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /parse analysis/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /prompt editor/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /pipeline/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /solver stats/i })).toBeInTheDocument()
  })

  it('marks the active route with aria-current', () => {
    render(
      <MemoryRouter initialEntries={['/summer/debug/solver']}>
        <DebugTabs />
      </MemoryRouter>
    )
    const active = screen.getByRole('link', { name: /solver stats/i })
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('does not render a "new" badge on the Solver Stats tab', () => {
    render(
      <MemoryRouter initialEntries={['/summer/debug/parse-analysis']}>
        <DebugTabs />
      </MemoryRouter>
    )
    const solverTab = screen.getByRole('link', { name: /solver stats/i })
    expect(solverTab.textContent?.toLowerCase()).not.toContain('new')
  })
})
