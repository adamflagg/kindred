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
    allowOverflow: false,
    onAllowOverflowChange: vi.fn(),
    ...overrides,
  }
}

function openDropdown() {
  const chevronBtn = screen.getByRole('button', { name: /select optimization level/i })
  fireEvent.click(chevronBtn)
}

describe('OptimizeBunksButton — partial re-solve controls', () => {
  // A. lockedCount=0 → main button text is "Optimize"; dropdown has NO "Allow up to 13" and NO scope line
  it('A: shows "Optimize" when lockedCount=0 and dropdown has no overflow controls', () => {
    render(<OptimizeBunksButton {...makeProps({ lockedCount: 0, unlockedCount: 0 })} />)

    // Main button text
    expect(screen.getByText('Optimize')).toBeInTheDocument()

    // Open the dropdown
    openDropdown()

    // No overflow checkbox and no scope line
    expect(screen.queryByText(/allow up to 13/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/locked \d+ · re-solving \d+/i)).not.toBeInTheDocument()
  })

  // B. lockedCount=3, unlockedCount=5 → main button text is "Solve" (short label, no wrap)
  it('B: shows "Solve" when lockedCount=3, unlockedCount=5 (not solving/applying)', () => {
    render(<OptimizeBunksButton {...makeProps({ lockedCount: 3, unlockedCount: 5 })} />)

    expect(screen.getByText('Solve')).toBeInTheDocument()
    expect(screen.queryByText(/re-solve unlocked/i)).not.toBeInTheDocument()
  })

  // C. lockedCount=3, unlockedCount=5 → dropdown shows overflow checkbox AND scope line
  it('C: dropdown shows overflow checkbox and scope line when lockedCount>0', () => {
    render(<OptimizeBunksButton {...makeProps({ lockedCount: 3, unlockedCount: 5 })} />)

    openDropdown()

    expect(screen.getByText(/allow up to 13 per cabin/i)).toBeInTheDocument()
    expect(screen.getByText(/locked 3 · re-solving 5/i)).toBeInTheDocument()
  })

  // D. With lockedCount>0, clicking the overflow checkbox calls onAllowOverflowChange(true)
  it('D: clicking overflow checkbox calls onAllowOverflowChange(true)', () => {
    const onAllowOverflowChange = vi.fn()
    render(
      <OptimizeBunksButton
        {...makeProps({
          lockedCount: 3,
          unlockedCount: 5,
          allowOverflow: false,
          onAllowOverflowChange,
        })}
      />
    )

    openDropdown()

    const overflowLabel = screen.getByText(/allow up to 13 per cabin/i)
    const overflowCheckbox = overflowLabel
      .closest('label')!
      .querySelector('input[type="checkbox"]')!
    fireEvent.click(overflowCheckbox)

    expect(onAllowOverflowChange).toHaveBeenCalledWith(true)
  })
})
