/** The bulk confirm dialog's headline says what Confirm marks Posted (owner ruling 2026-10-09). */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BulkPlaceDialog } from './BulkPlaceDialog'
import type { BulkPlan } from './bulkPlaceModel'
import { CHEN_EXACT, RILEY_EXACT } from './toPlaceFixtures'

vi.mock('../../../hooks/camperships/useAidToPlaceWrites', () => ({
  useAidPlaceLines: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

const withLock = (line: typeof CHEN_EXACT, lock: number) => ({
  ...line,
  suggestion: line.suggestion === null ? null : { ...line.suggestion, would_lock: lock },
})

const planOf = (lines: Array<typeof CHEN_EXACT>): BulkPlan => ({
  lines: lines.map((line) => ({ line, hidden: false })),
  leftOut: [],
  households: lines.length,
  gone: 0,
})

function show(plan: BulkPlan) {
  render(
    <BulkPlaceDialog
      plan={plan}
      year={2027}
      allLines={[]}
      onClose={vi.fn()}
      onDone={vi.fn()}
      onRefused={vi.fn()}
    />
  )
}

describe('BulkPlaceDialog headline', () => {
  it('says what it marks Posted when something is', () => {
    show(planOf([withLock(CHEN_EXACT, 1500), withLock(RILEY_EXACT, 300)]))
    expect(screen.getByText(/^2 lines · 2 households · marks \$1,800 Posted/)).toBeInTheDocument()
    expect(screen.getByText('Estimate')).toBeInTheDocument()
    // Final UX (mock `dialog`): one effect per line, ○ for the estimate and → for where the exact list is.
    expect(screen.getByText(/mark more or less Posted together than apart/)).toBeInTheDocument()
    expect(
      screen.getByText('→ The result lists exactly what was marked Posted')
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/lock/i)
  })

  it('says Posted stays to check by hand when nothing would be marked', () => {
    show(planOf([withLock(CHEN_EXACT, 0)]))
    expect(
      screen.getByText('1 line · 1 household · places the money; Posted stays to check by hand')
    ).toBeInTheDocument()
    expect(screen.queryByText('Estimate')).toBeNull()
    expect(document.body.textContent).not.toMatch(/lock/i)
  })
})

describe('BulkPlaceDialog is wide and short (design-language §24)', () => {
  // Pin changed (ux3 to-place-2): the final mock's `.cf-modal`: a boxed one-line list (no columns) and a footer
  // band, the History sentence at its left and Back then Confirm N at its right (was: two columns, buttons left).
  it('lists the lines one per row in a box and puts Back and Confirm in a footer band with the History line', () => {
    show(planOf([withLock(CHEN_EXACT, 1500), withLock(RILEY_EXACT, 300)]))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('ul.columns-2')).toBeNull()
    expect(within(dialog).getByTestId('bulk-place-names')).toHaveClass('border', 'rounded-lg')
    const confirm = within(dialog).getByRole('button', { name: 'Confirm 2' })
    const back = within(dialog).getByRole('button', { name: 'Back' })
    expect(confirm.parentElement).toBe(back.parentElement)
    expect(within(dialog).getByTestId('bulk-place-footer')).toHaveTextContent(
      'All or nothing · one operation in Season › History'
    )
    expect(back.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('explains in short lines with symbols', () => {
    show(planOf([withLock(CHEN_EXACT, 1500)]))
    expect(screen.getByText("The line goes on its family's one request")).toBeInTheDocument()
    expect(
      screen.getByText(/If what it marks Posted moved since the page loaded, nothing is written/)
    ).toBeInTheDocument()
  })
})
