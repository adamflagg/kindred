import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { aidSection } from '../../../config/aidNav'
import { AidTabNav } from './AidTabNav'

const season = aidSection('season')

function renderAt(path: string, asOf: Parameters<typeof AidTabNav>[0]['view']['asOf']) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AidTabNav section={season} tabs={season.tabs} view={{ year: 2027, asOf }} />
    </MemoryRouter>
  )
}

describe('AidTabNav (§3.6: tabs live in the URL)', () => {
  it('links each tab to its own path and marks the current one', () => {
    renderAt('/aid/season/rules', { kind: 'live' })
    expect(screen.getByRole('link', { name: 'Rules' })).toHaveAttribute(
      'href',
      '/aid/season/rules?year=2027'
    )
    expect(screen.getByRole('link', { name: 'Rules' })).toHaveClass('bg-primary')
    expect(screen.getByRole('link', { name: 'History' })).not.toHaveClass('bg-primary')
  })

  it('carries the season and a past as-of from tab to tab (D15, Decision 9)', () => {
    renderAt('/aid/season/rules?year=2027&as_of=2026-04-01', {
      kind: 'past',
      date: '2026-04-01',
      axis: 'campminder',
    })
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute(
      'href',
      '/aid/season/history?year=2027&as_of=2026-04-01'
    )
  })
})
