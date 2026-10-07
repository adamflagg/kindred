import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidScenarioFit } from '../../../../types/api-types'
import { FitAnswer, FitToBudgetButton } from './FitToBudget'
import { results, scenarioDraft } from './scenarioFixtures'

const FIT: ApiAidScenarioFit = {
  tier_shift: 2,
  outcome: 'fits',
  tightest_pool: 'pool_b',
  tried: 9,
  document: scenarioDraft().document,
  results: results(780000),
  report: { issues: [] },
}

describe('Fit to Budget on the Tiers card (§S5 G)', () => {
  it('is a button that says why it is off under Price ▾', async () => {
    const onFit = vi.fn()
    const { rerender } = render(
      <FitToBudgetButton disabled={false} reason={null} pending={false} onFit={onFit} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Fit to Budget' }))
    expect(onFit).toHaveBeenCalledOnce()
    rerender(
      <FitToBudgetButton
        disabled
        reason="Fit uses every application held"
        pending={false}
        onFit={onFit}
      />
    )
    expect(screen.getByRole('button', { name: 'Fit to Budget' })).toBeDisabled()
    expect(screen.getByText('Fit uses every application held')).toBeInTheDocument()
  })

  it('answers in the new words, with Use It when it fits and Not Now', async () => {
    const onUse = vi.fn()
    const onDismiss = vi.fn()
    render(<FitAnswer answer={FIT} stale={false} canUse onUse={onUse} onDismiss={onDismiss} />)
    expect(screen.getByText(/uses the budget: Round 1 \$780,000/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use It' }))
    await userEvent.click(screen.getByRole('button', { name: 'Not Now' }))
    expect([onUse.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1])
  })

  it('says to fit again once the draft changed', () => {
    render(<FitAnswer answer={FIT} stale canUse onUse={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('Your draft changed since: fit again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use It' })).toBeNull()
  })
})
