import { render, screen, within } from '@testing-library/react'
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

describe('Fit to Budget on the Tiers card (§S5 G; scenarios-13)', () => {
  it('is a button whose title says what it does, and says why it is off only in its title', async () => {
    const onFit = vi.fn()
    const { rerender } = render(
      <FitToBudgetButton disabled={false} reason={null} pending={false} onFit={onFit} />
    )
    const on = screen.getByRole('button', { name: 'Fit to Budget' })
    expect(on).toHaveAttribute(
      'title',
      "Shifts every tier's Round 1 % by the same points until Round 1 uses the budget"
    )
    await userEvent.click(on)
    expect(onFit).toHaveBeenCalledOnce()
    for (const reason of [
      'Off once Round 1 posts',
      'Fit uses every application held',
      'Nothing is held yet',
    ]) {
      rerender(<FitToBudgetButton disabled reason={reason} pending={false} onFit={onFit} />)
      expect(screen.getByRole('button', { name: 'Fit to Budget' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Fit to Budget' })).toHaveAttribute('title', reason)
      // never as a line beside the button
      expect(screen.queryByText(reason)).toBeNull()
    }
  })

  it('answers in ONE line in the done box, the tightest pool short beside it and in full in the title', async () => {
    const onUse = vi.fn()
    const onDismiss = vi.fn()
    render(<FitAnswer answer={FIT} stale={false} canUse onUse={onUse} onDismiss={onDismiss} />)
    const box = screen.getByTestId('fit-answer')
    expect(box).toHaveAttribute('data-tone', 'done')
    expect(box).toHaveClass('flex-nowrap')
    expect(screen.getByText(/uses the budget: Round 1 \$780,000/)).toBeInTheDocument()
    expect(screen.getByText('Tightest pool: Pool B')).toBeInTheDocument()
    expect(
      within(box).getByTitle(/Tightest pool: Pool B, Round 1 remaining .* Pools are guidance/)
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use It' }))
    await userEvent.click(screen.getByRole('button', { name: 'Not Now' }))
    expect([onUse.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1])
  })

  it('answers in the amber box, with Not Now alone, when even the highest shift leaves money unused', () => {
    render(
      <FitAnswer
        answer={{ ...FIT, outcome: 'under_at_highest' }}
        stale={false}
        canUse
        onUse={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByTestId('fit-answer')).toHaveAttribute('data-tone', 'warn')
    expect(screen.getByText(/Even the highest shift/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use It' })).toBeNull()
  })

  it('says to fit again once the draft changed', () => {
    render(<FitAnswer answer={FIT} stale canUse onUse={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('Your draft changed since: fit again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use It' })).toBeNull()
  })
})
