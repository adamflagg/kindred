import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidWriteError } from '../../../services/camperships/aidApi'
import { BulkConfirmDialog } from './BulkConfirmDialog'
import { ROW_EMMA, ROW_LIAM, ROW_RILEY, ROW_SAMUEL } from './gridFixtures'
import { tickPlan } from './ticks'

const accepted = vi.fn()
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidTickAccepted: () => ({ mutateAsync: accepted, isPending: false }),
}))

const onDone = vi.fn()
const OK = { year: 2027, written: 1, unchanged: 0, operation_id: 'op1' }

beforeEach(() => {
  accepted.mockReset()
  onDone.mockReset()
})

function open(
  rows = [ROW_SAMUEL, ROW_RILEY],
  props: { onClose?: () => void; hidden?: ReadonlySet<string> } = {}
) {
  return render(
    <BulkConfirmDialog
      plan={tickPlan(rows, 'accepted', props.hidden)}
      year={2027}
      onClose={props.onClose ?? (() => undefined)}
      onDone={onDone}
    />
  )
}

describe('BulkConfirmDialog (§4.10)', () => {
  it('shows what it will tick, and writes exactly that, with accepted: true', async () => {
    accepted.mockResolvedValue({ ...OK, written: 2 })
    open()
    expect(screen.getByText('Tick Accepted on 2 requests · 2 families')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(accepted).toHaveBeenCalledWith({
      year: 2027,
      body: {
        rows: [
          { request_id: 'reqsamuel000005', round: 1 },
          { request_id: 'reqriley0000004', round: 1 },
        ],
        accepted: true,
      },
    })
    expect(onDone).toHaveBeenCalledWith(
      'Ticked Accepted on 2 requests',
      expect.objectContaining({ written: 2, unchanged: 0 })
    )
  })

  it('is titled Tick Accepted, and says nothing about locking an amount', () => {
    open()
    expect(screen.getByText('Tick Accepted', { selector: 'h2, h3, [id]' })).toBeInTheDocument()
    expect(screen.queryByText(/lock/i)).toBeNull()
  })

  it("quotes the server's words on a refusal, and says nothing was ticked (all or nothing)", async () => {
    accepted.mockRejectedValue(new AidWriteError('reqsamuel000005: round 1 is not posted', 422))
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByText('Samuel Johnson: round 1 is not posted')).toBeInTheDocument()
    expect(screen.queryByText(/reqsamuel/)).toBeNull()
    expect(screen.getByText(/Nothing was ticked/)).toBeInTheDocument()
  })

  it('does not claim nothing was ticked when the answer never arrived, and says ticking again is safe', async () => {
    accepted.mockRejectedValue(new TypeError('Failed to fetch'))
    open([ROW_SAMUEL])
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.queryByText(/Nothing was ticked/)).toBeNull()
    expect(screen.getByText(/can't tell whether/)).toBeInTheDocument()
    expect(screen.getByText(/ticking again is safe/)).toBeInTheDocument()
  })

  it('refuses a plan over the server limit instead of splitting it', () => {
    const many = Array.from({ length: 901 }, (_, i) => ({
      ...ROW_SAMUEL,
      request_id: `req${String(i).padStart(12, '0')}`,
    }))
    open(many)
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(screen.getByText(/at most 900/)).toBeInTheDocument()
  })

  it('names the selected rows it leaves out', () => {
    open([ROW_SAMUEL, ROW_LIAM])
    expect(screen.getByText(/Nothing to tick on Liam Garcia/)).toBeInTheDocument()
  })

  // Two guards stop a double submit (`disabled={busy}` and `if (busy) return` in confirm), so dropping
  // either alone is an equivalent mutant; dropping BOTH makes this fail (checked in the PR 4 fix wave).
  it('sends one write for a double click (the button is disabled once it is in flight)', async () => {
    let finish: (v: unknown) => void = () => undefined
    accepted.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    open([ROW_SAMUEL])
    await userEvent.dblClick(screen.getByRole('button', { name: 'Confirm' }))
    expect(accepted).toHaveBeenCalledTimes(1)
    await act(async () => finish(OK))
  })

  it('shows Ticking… while the write is in flight, and cannot be closed by Cancel or Escape', async () => {
    let finish: (v: unknown) => void = () => undefined
    accepted.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const onClose = vi.fn()
    open([ROW_SAMUEL], { onClose })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('button', { name: 'Ticking…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => finish(OK))
  })

  it('lists every ticked row, and marks the ones a search or filter hides', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      ...ROW_SAMUEL,
      request_id: `req${String(i).padStart(12, '0')}`,
      camper_name: `Camper ${String(i)}`,
    }))
    open(many, { hidden: new Set([many[14]?.request_id ?? '']) })
    expect(
      screen.getByText(/Camper 14 · Round 1 \(hidden by the search or filters\)/)
    ).toBeInTheDocument()
    expect(screen.getAllByText(/ · Round 1/)).toHaveLength(15)
  })

  it('caps the names it leaves out at ten, and says how many more', () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      ...ROW_LIAM,
      request_id: `reqliam${String(i).padStart(8, '0')}`,
      camper_name: `Nobody ${String(i)}`,
    }))
    open([ROW_SAMUEL, ...rows])
    expect(screen.getByText(/Nobody 9/)).toBeInTheDocument()
    expect(screen.queryByText(/Nobody 10/)).toBeNull()
    expect(screen.getByText(/and 3 more/)).toBeInTheDocument()
  })

  it('reads "Nothing to tick" for an empty plan', () => {
    open([ROW_EMMA])
    expect(screen.getByText('Nothing to tick')).toBeInTheDocument()
    expect(screen.queryByText(/0 requests/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })

  it('holds the X, Escape and the backdrop while the write is in flight', async () => {
    let finish: (v: unknown) => void = () => undefined
    accepted.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const onClose = vi.fn()
    open([ROW_SAMUEL], { onClose })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('button', { name: 'Close modal' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Close modal' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByTestId('modal-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => finish(OK))
  })
})
