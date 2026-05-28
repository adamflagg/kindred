import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import OptimizeBunksButton from './OptimizeBunksButton'

function makeProps(overrides: Partial<Parameters<typeof OptimizeBunksButton>[0]> = {}) {
  return {
    isSolving: false,
    isApplyingResults: false,
    onRunSolver: vi.fn(),
    respectLocks: false,
    onRespectLocksChange: vi.fn(),
    lockedCount: 0,
    unlockedCount: 0,
    ...overrides,
  }
}

describe('OptimizeBunksButton — partial re-solve controls (Stream C)', () => {
  // Stream C removed the "Allow up to 13 per cabin" checkbox entirely.
  // The smart orchestrator auto-uses overflow only when strict 12-cap is
  // infeasible, minimally — no staff opt-in required.

  // A. lockedCount=0 → main button text is "Optimize"
  it('A: shows "Optimize" when lockedCount=0', () => {
    render(<OptimizeBunksButton {...makeProps({ lockedCount: 0, unlockedCount: 0 })} />)
    expect(screen.getByText('Optimize')).toBeInTheDocument()
  })

  // B. lockedCount=3, unlockedCount=5 → main button text is "Solve"
  it('B: shows "Solve" when lockedCount=3, unlockedCount=5 (not solving/applying)', () => {
    render(<OptimizeBunksButton {...makeProps({ lockedCount: 3, unlockedCount: 5 })} />)
    expect(screen.getByText('Solve')).toBeInTheDocument()
    expect(screen.queryByText(/re-solve unlocked/i)).not.toBeInTheDocument()
  })
})
