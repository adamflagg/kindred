import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EditorPreview } from '../kit/RequestEditor'
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
let previewNow: EditorPreview = { status: 'idle' }
const previewAsk = vi.fn()
vi.mock('../../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => ({ preview: previewNow, onAmountChange: previewAsk }),
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
  previewAsk.mockReset()
  onClose.mockReset()
  go.mockReset()
  mode = 'auto'
  pending = []
  previewNow = { status: 'idle' }
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

  describe('the after-edit total (Decision 40)', () => {
    const ready = (over: Partial<EditorPreview> = {}): EditorPreview => ({
      status: 'ready',
      award: 780,
      totalDecided: 2280,
      pendingApproval: false,
      ...over,
    })

    it('says what the appeal makes Round 2 and the new total', () => {
      previewNow = ready()
      render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
      expect(screen.getByText('Round 2 now $780 (new total $2,280)')).toBeInTheDocument()
    })

    it('says a Round 3 amount waiting on finance is not yet the award, and the total stays', () => {
      previewNow = ready({ award: 450, pendingApproval: true })
      render(<CardEditor request={request} page={page} kind="round3_amount" onClose={onClose} />)
      expect(
        screen.getByText('Round 3 would be $450 once finance approves · total stays $2,280')
      ).toBeInTheDocument()
    })

    it('says a decided Round 3 amount as Round 3 now', () => {
      previewNow = ready({ award: 450 })
      render(<CardEditor request={request} page={page} kind="round3_amount" onClose={onClose} />)
      expect(screen.getByText('Round 3 now $450 (new total $2,280)')).toBeInTheDocument()
    })

    it('shows no line when the server sent no total', () => {
      previewNow = ready({ totalDecided: null })
      render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
      expect(screen.queryByText(/new total|total stays/)).not.toBeInTheDocument()
    })

    it('shows no line without an award, or before the preview is ready', () => {
      previewNow = ready({ award: null })
      const { unmount } = render(
        <CardEditor request={request} page={page} kind="appeal" onClose={onClose} />
      )
      expect(screen.queryByText(/new total|total stays/)).not.toBeInTheDocument()
      unmount()
      previewNow = { status: 'loading', award: 780, totalDecided: 2280 }
      render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
      expect(screen.queryByText(/new total|total stays/)).not.toBeInTheDocument()
    })

    it('shows no line on a Round 3 ask, which prices nothing', () => {
      previewNow = ready()
      render(<CardEditor request={request} page={page} kind="round3_ask" onClose={onClose} />)
      expect(screen.queryByText(/new total|total stays/)).not.toBeInTheDocument()
    })
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

// B24 (owner ruling 10-05): a money editor opening on an amount asks for its preview at once, so
// "Round 2 now $X (new total $T)" shows before any typing.
describe('CardEditor: the preview at open (B24)', () => {
  it('asks once for the appeal it opens on, and shows the line without typing', () => {
    previewNow = { status: 'ready', award: 780, totalDecided: 2280, pendingApproval: false }
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    expect(previewAsk).toHaveBeenCalledTimes(1)
    expect(previewAsk).toHaveBeenCalledWith(1200)
    expect(screen.getByText('Round 2 now $780 (new total $2,280)')).toBeInTheDocument()
  })

  it('asks for a Round 3 amount opening on its decided figure', () => {
    const decidedRow = householdRequest(
      gridRow({
        ...ROW_OLIVIA,
        rounds: [roundOut(1, 'posted'), roundOut(3, 'needs_offer', { ask: 900, decided: 300 })],
      })
    )
    render(<CardEditor request={decidedRow} page={page} kind="round3_amount" onClose={onClose} />)
    expect(previewAsk).toHaveBeenCalledTimes(1)
    expect(previewAsk).toHaveBeenCalledWith(300)
  })

  it('asks nothing when there is no amount yet, nor for a Round 3 ask, which prices nothing', () => {
    const { unmount } = render(
      <CardEditor request={request} page={page} kind="round3_amount" onClose={onClose} />
    )
    expect(screen.getByLabelText('Round 3 amount')).toHaveValue('')
    unmount()
    const askedRow = householdRequest(
      gridRow({
        ...ROW_OLIVIA,
        rounds: [roundOut(1, 'posted'), roundOut(3, 'needs_offer', { ask: 900 })],
      })
    )
    render(<CardEditor request={askedRow} page={page} kind="round3_ask" onClose={onClose} />)
    expect(screen.getByLabelText('Round 3 ask')).toHaveValue('900')
    expect(previewAsk).not.toHaveBeenCalled()
  })
})

// Round 3 (mock section 2, option B "Two columns"): the fields on the left, what saving does on the
// right, and a footer with the save bottom right and Back beside it.
describe('CardEditor: two columns (round 3)', () => {
  const side = () => document.querySelector('[data-editor-side]') as HTMLElement

  it('puts the fields on the left and the preview line on the right', () => {
    previewNow = { status: 'ready', award: 780, totalDecided: 2280, pendingApproval: false }
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    expect(side()).toHaveTextContent('Round 2 now $780 (new total $2,280)')
    expect(side()).not.toContainElement(screen.getByLabelText('Round 2 ask'))
    expect(side()).not.toContainElement(screen.getByLabelText('Note'))
  })

  it('names the household in the head, beside what is being edited', () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    const head = screen.getByText('Editing · Round 2 ask').parentElement as HTMLElement
    expect(head).toHaveTextContent(/household \d+ · person \d+/)
    expect(head).not.toContainElement(screen.getByLabelText('Round 2 ask'))
  })

  it('says on the right that the award waits for an amount, while there is none', () => {
    render(<CardEditor request={request} page={page} kind="round3_amount" onClose={onClose} />)
    expect(side()).toHaveTextContent('Type an amount to see the award.')
  })

  it('says a Round 3 ask prices nothing, on the right', () => {
    render(<CardEditor request={request} page={page} kind="round3_ask" onClose={onClose} />)
    expect(side()).toHaveTextContent(
      'An ask alone prices nothing: finance sets the Round 3 amount.'
    )
  })

  it('saves from the footer button as Enter does, with Back beside it and the save last', async () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    const save = screen.getByRole('button', { name: 'Save the Appeal' })
    const back = screen.getByRole('button', { name: 'Back' })
    expect(save.parentElement?.lastElementChild).toBe(save)
    expect(back.nextElementSibling).toBe(save)
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
    await userEvent.click(save)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith({
      requestId: 'reqolivia000003',
      body: { round: 2, amount: 1300, asked_on: '2027-04-09', note: 'Family emailed (Apr 9)' },
    })
  })

  it('goes back from Back without saving', async () => {
    render(<CardEditor request={request} page={page} kind="round3_amount" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onClose).toHaveBeenCalled()
    expect(amount).not.toHaveBeenCalled()
  })

  it('labels the Round 3 saves', () => {
    const { unmount } = render(
      <CardEditor request={request} page={page} kind="round3_ask" onClose={onClose} />
    )
    expect(screen.getByRole('button', { name: 'Save the Ask' })).toBeInTheDocument()
    unmount()
    render(<CardEditor request={request} page={page} kind="round3_amount" onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Save the Amount' })).toBeInTheDocument()
  })

  it('keeps Back off while a save is in flight, so its refusal shows here', async () => {
    mode = 'manual'
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{Enter}')
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    settle(new Error('The server said no'))
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
    expect(screen.getByText('The server said no')).toBeInTheDocument()
  })

  it("draws white fields, not the grid editor's grey ones", () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    for (const field of [screen.getByLabelText('Round 2 ask'), screen.getByLabelText('Note')]) {
      expect(field).toHaveClass('bg-white')
      expect(field).not.toHaveClass('bg-background')
    }
  })

  it('gives the statement of need a box of at least three rows that grows, and says its keys', () => {
    render(<CardEditor request={request} page={page} kind="round3_ask" onClose={onClose} />)
    const box = screen.getByLabelText('Statement of need')
    expect(box.tagName).toBe('TEXTAREA')
    expect(Number(box.getAttribute('rows'))).toBeGreaterThanOrEqual(3)
    expect(box).toHaveClass('field-sizing-content')
    expect(
      screen.getByText('Enter saves · Shift+Enter for a new line · Esc cancels')
    ).toBeInTheDocument()
  })

  it('makes a new line on Shift+Enter in the statement, and closes on Esc from it', async () => {
    render(<CardEditor request={request} page={page} kind="round3_ask" onClose={onClose} />)
    const box = screen.getByLabelText('Statement of need')
    await userEvent.type(box, 'one{Shift>}{Enter}{/Shift}two')
    expect(box).toHaveValue('one\ntwo')
    expect(ask).not.toHaveBeenCalled()
    await userEvent.type(box, '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Esc with Back focused, once', async () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    screen.getByRole('button', { name: 'Back' }).focus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes once on Esc from a field', async () => {
    render(<CardEditor request={request} page={page} kind="appeal" onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
