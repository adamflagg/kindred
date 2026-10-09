import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FreshnessChip } from './FreshnessChip'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('FreshnessChip (one grammar for every secondary bar)', () => {
  it('reads "<noun> synced <compact age>" with the refresh icon', () => {
    render(<FreshnessChip noun="Housing" verb="synced" at="2026-10-08T00:00:00Z" title="t" />)
    const chip = screen.getByText('Housing synced 18h ago')
    expect(chip.querySelector('svg.lucide-refresh-cw')).not.toBeNull()
    expect(chip.querySelector('svg.lucide-upload')).toBeNull()
  })

  it('reads "<noun> uploaded <compact age>" with the upload icon, so a CSV never looks like a sync', () => {
    render(<FreshnessChip noun="Requests" verb="uploaded" at="2026-10-05T18:00:00Z" title="t" />)
    const chip = screen.getByText('Requests uploaded 3d ago')
    expect(chip.querySelector('svg.lucide-upload')).not.toBeNull()
    expect(chip.querySelector('svg.lucide-refresh-cw')).toBeNull()
  })

  it('keeps the full detail in the tooltip and never wraps', () => {
    render(
      <FreshnessChip
        noun="Ledger"
        verb="synced"
        at="2026-10-08T12:00:00Z"
        title="Last aid ledger sync"
      />
    )
    const chip = screen.getByText('Ledger synced 6h ago')
    expect(chip).toHaveAttribute('title', 'Last aid ledger sync')
    expect(chip).toHaveClass('whitespace-nowrap')
  })
})
