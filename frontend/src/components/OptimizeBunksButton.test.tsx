import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  // B. respectLocks=true + lockedCount=3, unlockedCount=5 → "Solve" (partial re-solve)
  it('B: shows "Solve" when respectLocks=true and lockedCount=3, unlockedCount=5', () => {
    render(
      <OptimizeBunksButton
        {...makeProps({ respectLocks: true, lockedCount: 3, unlockedCount: 5 })}
      />
    )
    expect(screen.getByText('Solve')).toBeInTheDocument()
    expect(screen.queryByText(/re-solve unlocked/i)).not.toBeInTheDocument()
  })

  // C. respectLocks=false but locked cabins exist → full re-solve, so "Optimize".
  // The label/scope must reflect the actual solve mode, not the mere presence of
  // locks (the solver ignores locks when respectLocks is false).
  it('C: shows "Optimize" when respectLocks=false even though lockedCount>0', () => {
    render(
      <OptimizeBunksButton
        {...makeProps({ respectLocks: false, lockedCount: 3, unlockedCount: 5 })}
      />
    )
    expect(screen.getByText('Optimize')).toBeInTheDocument()
  })

  // D. respectLocks=true + locked cabins → the "Locked N · Re-solving M" scope
  // footer renders inside the open dropdown (sanity baseline for E).
  it('D: shows the locked-scope footer when respectLocks=true (dropdown open)', () => {
    render(
      <OptimizeBunksButton
        {...makeProps({ respectLocks: true, lockedCount: 3, unlockedCount: 5 })}
      />
    )
    fireEvent.click(screen.getByLabelText('Select optimization level'))
    expect(screen.getByText(/Locked 3 · Re-solving 5/)).toBeInTheDocument()
  })

  // E. respectLocks=false + locked cabins → footer must NOT render (it would
  // misdescribe a full re-solve as a partial one). Dropdown is opened so the
  // assertion exercises the real conditional, not the closed-menu default.
  it('E: hides the locked-scope footer when respectLocks=false (dropdown open)', () => {
    render(
      <OptimizeBunksButton
        {...makeProps({ respectLocks: false, lockedCount: 3, unlockedCount: 5 })}
      />
    )
    fireEvent.click(screen.getByLabelText('Select optimization level'))
    expect(screen.queryByText(/Locked 3 · Re-solving 5/)).not.toBeInTheDocument()
  })
})
