import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, roundOut, ROW_OLIVIA } from '../requests/gridFixtures'
import { CardEditor, type CardEditorHandle } from './CardEditor'
import { householdPage, householdRequest } from './householdFixtures'

const ask = vi.fn()
const amount = vi.fn()
interface Call {
  onSuccess?: () => void
  onError?: (e: Error) => void
}
// 'auto' saves at once; 'manual' leaves the save pending until the test settles it.
let mode: 'auto' | 'manual' = 'auto'
let pending: Call[] = []
// Typed as plain functions: vitest 5's `Mock` type isn't callable under tsc (I1).
function useFakeMutation(spy: (vars: unknown) => unknown) {
  const [state, setState] = useState<{ isPending: boolean; error: Error | null }>({
    isPending: false,
    error: null,
  })
  return {
    ...state,
    mutate: (vars: unknown, options?: Call) => {
      spy(vars)
      if (mode === 'auto') {
        options?.onSuccess?.()
        return
      }
      setState({ isPending: true, error: null })
      pending.push({
        onSuccess: () => {
          setState({ isPending: false, error: null })
          options?.onSuccess?.()
        },
        onError: (e) => {
          setState({ isPending: false, error: e })
          options?.onError?.(e)
        },
      })
    },
  }
}
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidKeyAsk: () => useFakeMutation(ask),
  useAidRound3Amount: () => useFakeMutation(amount),
}))
vi.mock('../../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => ({ preview: { status: 'idle' }, onAmountChange: () => undefined }),
}))

const request = householdRequest(ROW_OLIVIA)
const page = householdPage({ requests: [request] })
const onClose = vi.fn()
const go = vi.fn()

const settle = (error?: Error) => {
  const call = pending.shift()
  act(() => {
    if (error) call?.onError?.(error)
    else call?.onSuccess?.()
  })
}

beforeEach(() => {
  ask.mockReset()
  amount.mockReset()
  onClose.mockReset()
  go.mockReset()
  mode = 'auto'
  pending = []
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

  it('opens a Round 3 amount on the pending figure, else the decided one', () => {
    const pendingRow = householdRequest(
      gridRow({
        ...ROW_OLIVIA,
        rounds: [
          roundOut(1, 'posted'),
          roundOut(3, 'pending_approval', { ask: 900, pending_approval: 450, decided: 300 }),
        ],
      })
    )
    const { unmount } = render(
      <CardEditor request={pendingRow} page={page} kind="round3_amount" onClose={onClose} />
    )
    expect(screen.getByLabelText('Round 3 amount')).toHaveValue('450')
    unmount()
    const decidedRow = householdRequest(
      gridRow({
        ...ROW_OLIVIA,
        rounds: [roundOut(1, 'posted'), roundOut(3, 'needs_offer', { ask: 900, decided: 300 })],
      })
    )
    render(<CardEditor request={decidedRow} page={page} kind="round3_amount" onClose={onClose} />)
    expect(screen.getByLabelText('Round 3 amount')).toHaveValue('300')
  })

  it("shows the server's refusal after a real save and stays open", async () => {
    mode = 'manual'
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{Enter}')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Round 2 is posted; its ask can't change")).not.toBeInTheDocument()
    settle(new Error("Round 2 is posted; its ask can't change"))
    expect(screen.getByText("Round 2 is posted; its ask can't change")).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the typed amount when the save fails', async () => {
    mode = 'manual'
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{Enter}')
    settle(new Error('The server said no'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
    expect(screen.getByText('The server said no')).toBeInTheDocument()
  })

  it('stands the page keys aside: the editor carries data-aid-editor', () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    expect(screen.getByLabelText('Round 2 ask').closest('[data-aid-editor]')).not.toBeNull()
  })

  it('shows no "new total" line: the standing figures are from before the edit', () => {
    // Needs the preview to carry the after-edit total (a back-end field, requested); until then the
    // editor shows only the preview's award, as the kit does.
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    expect(screen.queryByText(/new total/)).not.toBeInTheDocument()
  })

  it('closes on Esc without saving', async () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })

  it("never carries one kind's note into another kind's write (D22)", async () => {
    const { rerender } = render(
      <CardEditor request={request} page={page} kind="appeal" onClose={onClose} />
    )
    rerender(<CardEditor request={request} page={page} kind="round3_ask" onClose={onClose} />)
    await userEvent.keyboard('450{Enter}')
    expect(ask).not.toHaveBeenCalled()
    expect(screen.getByText('Statement of need is required')).toBeInTheDocument()
  })

  it('reports what is typed to the page', async () => {
    const onDraftChange = vi.fn()
    render(
      <CardEditor
        request={request}
        page={page}
        kind="appeal"
        onClose={onClose}
        onDraftChange={onDraftChange}
      />
    )
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        raw: '1300',
        save: { amount: 1300, reason: 'Family emailed (Apr 9)' },
      })
    )
  })
})

describe('CardEditor leave (F2 4/5: page-owned exits save first)', () => {
  const open = (kind: 'appeal' | 'round3_ask') => {
    const ref = createRef<CardEditorHandle>()
    render(<CardEditor ref={ref} request={request} page={page} kind={kind} onClose={onClose} />)
    return ref
  }

  it('goes at once when nothing is typed', () => {
    const ref = open('appeal')
    act(() => ref.current?.leave(go))
    expect(go).toHaveBeenCalledTimes(1)
    expect(ask).not.toHaveBeenCalled()
  })

  it('stays and shows what is missing when the edit cannot be saved', async () => {
    const ref = open('round3_ask')
    await userEvent.keyboard('450')
    act(() => ref.current?.leave(go))
    expect(go).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
    expect(screen.getByText('Statement of need is required')).toBeInTheDocument()
  })

  it("saves on the editor's own write, and goes only once it lands", async () => {
    mode = 'manual'
    const ref = open('appeal')
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
    act(() => ref.current?.leave(go))
    expect(ask).toHaveBeenCalledWith({
      requestId: 'reqolivia000003',
      body: { round: 2, amount: 1300, asked_on: '2027-04-09', note: 'Family emailed (Apr 9)' },
    })
    expect(go).not.toHaveBeenCalled()
    settle()
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('stays open with the typed amount and the error when the save fails, and never goes', async () => {
    mode = 'manual'
    const ref = open('appeal')
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
    act(() => ref.current?.leave(go))
    settle(new Error('The server said no'))
    expect(go).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
    expect(screen.getByText('The server said no')).toBeInTheDocument()
  })

  it('waits for a save already in flight, and goes when it succeeds', async () => {
    mode = 'manual'
    const ref = open('appeal')
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{Enter}')
    act(() => ref.current?.leave(go))
    expect(ask).toHaveBeenCalledTimes(1)
    expect(go).not.toHaveBeenCalled()
    settle()
    expect(go).toHaveBeenCalledTimes(1)
  })
})
