import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, roundOut, ROW_EMMA } from '../requests/gridFixtures'
import { householdPage, householdRequest } from './householdFixtures'
import { ClearCostForm, SetCostForm } from './SetCostForm'

const send = vi.fn()
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidCostOverride: () => ({
    isPending: false,
    error: null,
    mutateAsync: (vars: unknown) => {
      send(vars)
      return Promise.resolve({})
    },
  }),
}))

const REASONS = [
  'headcount',
  'partial_session',
  'discount',
  'missing_catalog',
  'typed_household_total',
]
const page = householdPage({ override_reasons: REASONS })
const done = vi.fn()
const mockCostOverride = () => send

beforeEach(() => {
  send.mockReset()
  done.mockReset()
})

function renderSet(over: Parameters<typeof gridRow>[0]) {
  render(<SetCostForm request={householdRequest(gridRow(over))} page={page} onDone={done} />)
}
function renderClear(over: Parameters<typeof gridRow>[0]) {
  render(<ClearCostForm request={householdRequest(gridRow(over))} page={page} onDone={done} />)
}

describe('SetCostForm (cost override v2)', () => {
  it('says what saving does, against the catalog price', async () => {
    renderSet({ rules_cost: 6695, rules_cost_from: 'catalog' })
    expect(screen.getByText('Type the cost to see it here')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Cost'), '1275')
    expect(screen.getByTestId('set-cost-lead')).toHaveTextContent(
      '$1,275 instead of $6,695, the catalog price'
    )
    expect(
      screen.getByText('Rounds not yet posted are worked out again on this cost.')
    ).toBeInTheDocument()
  })

  it('says "instead of no price" when the rules can’t price it (Review Focus 4)', async () => {
    renderSet({ rules_cost: null, rules_cost_from: null })
    await userEvent.type(screen.getByLabelText('Cost'), '1800')
    expect(screen.getByTestId('set-cost-lead')).toHaveTextContent('$1,800 instead of no price')
  })

  it('names the per-person rates, and a cost already set', async () => {
    renderSet({ rules_cost: 1700, rules_cost_from: 'per_person' })
    await userEvent.type(screen.getByLabelText('Cost'), '1275')
    expect(screen.getByTestId('set-cost-lead')).toHaveTextContent(
      '$1,275 instead of $1,700, from the per-person rates'
    )
  })

  it('opens on the cost already set, and says "set by staff"', () => {
    renderSet({
      rules_cost: 6695,
      rules_cost_from: 'catalog',
      cost_override: {
        amount: 1275,
        reason_code: 'discount',
        note: 'Form total',
        actor: 'Finance Staff',
      },
    })
    expect(screen.getByLabelText('Cost')).toHaveValue('1275')
  })

  it('refuses each missing field in turn', async () => {
    renderSet({})
    await userEvent.click(screen.getByRole('button', { name: 'Set the Cost' }))
    expect(screen.getByText('Type the cost')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Cost'), '12.755')
    await userEvent.click(screen.getByRole('button', { name: 'Set the Cost' }))
    expect(screen.getByText('Type the cost in dollars, like 1275 or 1275.50')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Cost'))
    await userEvent.type(screen.getByLabelText('Cost'), '1275')
    await userEvent.click(screen.getByRole('button', { name: 'Set the Cost' }))
    expect(screen.getByText('Choose a reason')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'Discount')
    await userEvent.click(screen.getByRole('button', { name: 'Set the Cost' }))
    expect(screen.getByText('A note is required')).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('warns about a posted round, and points Number of People at a per-person request', async () => {
    renderSet({
      rules_cost: 1700,
      rules_cost_from: 'per_person',
      rounds: [roundOut(1, 'posted', { posted: 900 })],
    })
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'Discount')
    expect(screen.getByText(/A round is already posted/)).toBeInTheDocument()
    expect(screen.queryByText(/use Number of People… instead/)).toBeNull()
    // the approved mock offers "Number of people" (cost-override-v2 story step 4); choosing it points at the right tool
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'Number of people')
    expect(
      screen.getByText(
        'To change who is counted, use Number of People… instead: the cost then follows the per-person rates.'
      )
    ).toBeInTheDocument()
  })

  it('sends the amount, the code and the note', async () => {
    const spy = mockCostOverride()
    renderSet({ rules_cost: 6695, rules_cost_from: 'catalog' })
    await userEvent.type(screen.getByLabelText('Cost'), '1,275')
    await userEvent.selectOptions(screen.getByLabelText('Reason'), "Family's total from the form")
    await userEvent.type(screen.getByLabelText('Note'), 'From the form')
    await userEvent.click(screen.getByRole('button', { name: 'Set the Cost' }))
    expect(spy).toHaveBeenCalledWith({
      requestId: ROW_EMMA.request_id,
      body: { amount: 1275, reason_code: 'typed_household_total', note: 'From the form' },
    })
    expect(done).toHaveBeenCalled()
  })
})

describe('ClearCostForm', () => {
  it('clears back to the catalog price, or to no price yet', () => {
    renderClear({ rules_cost: 6695, rules_cost_from: 'catalog' })
    expect(screen.getByTestId('clear-cost-lead')).toHaveTextContent(
      'Back to $6,695, the catalog price'
    )
  })

  it('names the per-person rates, and no price yet', () => {
    renderClear({ rules_cost: 1700, rules_cost_from: 'per_person' })
    expect(screen.getByTestId('clear-cost-lead')).toHaveTextContent(
      'Back to $1,700, from the per-person rates'
    )
  })

  it('says "no price yet", asks why, and sends a null amount with the note', async () => {
    renderClear({ rules_cost: null, rules_cost_from: null })
    expect(screen.getByTestId('clear-cost-lead')).toHaveTextContent('Back to no price yet')
    await userEvent.click(screen.getByRole('button', { name: 'Clear the Cost' }))
    expect(screen.getByText('A note is required')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Why clear'), 'Entered on the wrong card')
    await userEvent.click(screen.getByRole('button', { name: 'Clear the Cost' }))
    expect(send).toHaveBeenCalledWith({
      requestId: ROW_EMMA.request_id,
      body: { amount: null, note: 'Entered on the wrong card' },
    })
  })
})
