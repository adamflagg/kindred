import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ROW_OLIVIA } from '../requests/gridFixtures'
import { CardEditor } from './CardEditor'
import { householdPage, householdRequest } from './householdFixtures'

const ask = vi.fn()
const amount = vi.fn()
let error: Error | null = null
// Typed as a plain function: vitest 5's `Mock` type isn't callable under tsc (I1).
const mutation = (spy: (vars: unknown) => unknown) => ({
  isPending: false,
  error,
  mutate: (vars: unknown, options?: { onSuccess?: () => void }) => {
    spy(vars)
    if (error === null) options?.onSuccess?.()
  },
})
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidKeyAsk: () => mutation(ask),
  useAidRound3Amount: () => mutation(amount),
}))
vi.mock('../../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => ({ preview: { status: 'idle' }, onAmountChange: () => undefined }),
}))

const request = householdRequest(ROW_OLIVIA)
const page = householdPage({ requests: [request] })
const onClose = vi.fn()

beforeEach(() => {
  ask.mockReset()
  amount.mockReset()
  onClose.mockReset()
  error = null
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-09T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('CardEditor (§4.6: the editor in place on the request card)', () => {
  it('keys the appeal from its Round 2 ask, dated today, and closes once saved', async () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1200')
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{Enter}')
    expect(ask).toHaveBeenCalledWith({
      requestId: 'reqolivia000003',
      body: { round: 2, amount: 1300, asked_on: '2027-04-09', note: 'Family emailed (Apr 9)' },
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('needs a statement of need for a Round 3 ask (D22)', async () => {
    render(<CardEditor request={request} page={page} kind="round3_ask" onClose={onClose} />)
    await userEvent.keyboard('450{Enter}')
    expect(ask).not.toHaveBeenCalled()
    expect(screen.getByText('Statement of need is required')).toBeInTheDocument()
    await userEvent.type(
      screen.getByLabelText('Statement of need'),
      'Second parent lost work{Enter}'
    )
    expect(ask).toHaveBeenCalledWith({
      requestId: 'reqolivia000003',
      body: {
        round: 3,
        amount: 450,
        asked_on: '2027-04-09',
        statement_of_need: 'Second parent lost work',
      },
    })
  })

  it('keys a Round 3 amount', async () => {
    render(<CardEditor request={request} page={page} kind="round3_amount" onClose={onClose} />)
    await userEvent.keyboard('450{Enter}')
    expect(amount).toHaveBeenCalledWith({
      requestId: 'reqolivia000003',
      body: { amount: 450, note: '' },
    })
    expect(ask).not.toHaveBeenCalled()
  })

  it("shows the server's refusal and stays open", async () => {
    error = new Error("Round 2 is posted; its ask can't change")
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    expect(screen.getByText("Round 2 is posted; its ask can't change")).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the typed amount when the save fails', async () => {
    error = new Error('The server said no')
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{Enter}')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
    expect(screen.getByText('The server said no')).toBeInTheDocument()
  })

  it('stands the page keys aside: the editor carries data-aid-editor', () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    expect(screen.getByLabelText('Round 2 ask').closest('[data-aid-editor]')).not.toBeNull()
  })

  it('shows the round amount beside the new total on Round 2 work (⚠ Decision 40)', () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    expect(screen.getByText('Round 2 now $780 (new total $2,200)')).toBeInTheDocument()
  })

  it('shows no such line for a Round 3 ask, which prices nothing', () => {
    render(<CardEditor request={request} page={page} kind="round3_ask" onClose={onClose} />)
    expect(screen.queryByText(/new total/)).not.toBeInTheDocument()
  })

  it('closes on Esc without saving', async () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })
})
