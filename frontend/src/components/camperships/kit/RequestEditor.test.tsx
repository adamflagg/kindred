import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { REASON_POLICY } from './editor'
import { EDITOR_PREVIEW_ROUND2 } from './fixtures'
import { RequestEditor, type EditorParts, type EditorPreview } from './RequestEditor'

const READY: EditorPreview = EDITOR_PREVIEW_ROUND2

function setup(over: Partial<Parameters<typeof RequestEditor>[0]> = {}) {
  const props = {
    familyName: 'Johnson',
    householdCmId: 1000001,
    personCmId: 1000002,
    amountLabel: 'Round 2 ask',
    initialAmount: null,
    policy: REASON_POLICY.appeal_ask,
    today: '2027-04-09',
    preview: READY,
    onAmountChange: vi.fn(),
    onSave: vi.fn(),
    onMove: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  const view = render(<RequestEditor {...props} />)
  return { ...props, rerender: view.rerender }
}

describe('the Round 2 preview fixture models the server (§6.3)', () => {
  const valueOf = (key: string) =>
    Number(EDITOR_PREVIEW_ROUND2.trace?.find((s) => s.key === key)?.value)

  it("awards the trace's own Round 2 value", () => {
    expect(EDITOR_PREVIEW_ROUND2.award).toBe(valueOf('r2'))
  })

  it("splits the request's decided total between the payers, not the Round 2 award", () => {
    const shares = EDITOR_PREVIEW_ROUND2.shares ?? []
    expect(shares.reduce((sum, share) => sum + share.amount, 0)).toBe(valueOf('total'))
    expect(shares.reduce((sum, share) => sum + share.pct, 0)).toBe(100)
  })

  it('shows those shares', () => {
    setup()
    expect(screen.getByText('1 · Johnson').parentElement).toHaveTextContent('60% · $2,700')
    expect(screen.getByText('2 · Garcia').parentElement).toHaveTextContent('40% · $1,800')
  })
})

describe("a long statement is a small text area, and its arrows are the caret's (m7)", () => {
  const round3 = { policy: REASON_POLICY.round3_ask, amountLabel: 'Round 3 ask' } as const

  it('renders the 4000-character statement as a textarea, and the 2000-character note as a line', () => {
    setup(round3)
    expect(screen.getByLabelText('Statement of need').tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('Statement of need')).toHaveAttribute('maxlength', '4000')
  })

  it('keeps a note a one-line input', () => {
    setup()
    expect(screen.getByLabelText('Note').tagName).toBe('INPUT')
  })

  it('saves once on Enter in it', async () => {
    const { onSave } = setup(round3)
    await userEvent.type(screen.getByLabelText('Round 3 ask'), '400')
    await userEvent.type(screen.getByLabelText('Statement of need'), 'Lost a job{Enter}{Enter}')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ amount: 400, reason: 'Lost a job' })
  })

  it('Shift+Enter makes a new line and does not save', async () => {
    const { onSave } = setup(round3)
    await userEvent.type(screen.getByLabelText('Round 3 ask'), '400')
    await userEvent.type(
      screen.getByLabelText('Statement of need'),
      'one{Shift>}{Enter}{/Shift}two'
    )
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Statement of need')).toHaveValue('one\ntwo')
  })

  it.each(['ArrowDown', 'ArrowUp'])(
    '%s in it neither saves nor moves, and is left to the caret',
    (key) => {
      const { onSave, onMove } = setup({ ...round3, initialAmount: 400 })
      fireEvent.change(screen.getByLabelText('Statement of need'), {
        target: { value: 'Lost a job' },
      })
      const notPrevented = fireEvent.keyDown(screen.getByLabelText('Statement of need'), { key })
      expect(notPrevented).toBe(true)
      expect(onSave).not.toHaveBeenCalled()
      expect(onMove).not.toHaveBeenCalled()
    }
  )
})

const SAVE = { amount: 2500, reason: 'Family emailed (Apr 9)' }

describe('RequestEditor (§4.6; D22, D27, D79)', () => {
  it('shows both CampMinder ids (D27)', () => {
    setup()
    expect(screen.getByText('Johnson · household 1000001 · person 1000002')).toBeInTheDocument()
  })

  it('opens with the amount field focused, and reports each amount typed so the surface can preview it', async () => {
    const { onAmountChange } = setup()
    expect(screen.getByLabelText('Round 2 ask')).toHaveFocus()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '25')
    expect(onAmountChange).toHaveBeenLastCalledWith(25)
  })

  it('shows the computed award, the limit that bound it, the stage change and the payer shares (D22)', () => {
    setup()
    expect(screen.getByText('Award')).toHaveTextContent('Award $1,000')
    expect(screen.getByText('limited by the Round 2 cap')).toBeInTheDocument()
    expect(screen.getByText('Stage → Needs an offer')).toBeInTheDocument()
    expect(screen.getByText('1 · Johnson')).toBeInTheDocument()
    expect(screen.getByText('2 · Garcia')).toBeInTheDocument()
  })

  it('pre-fills an appeal note, and Enter saves the amount with it', async () => {
    const { onSave } = setup()
    expect(screen.getByLabelText('Note')).toHaveValue('Family emailed (Apr 9)')
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '2,500{Enter}')
    expect(onSave).toHaveBeenCalledWith(SAVE)
  })

  it('↓ saves and moves to the next row (D22)', async () => {
    const { onSave, onMove } = setup()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{ArrowDown}')
    expect(onMove).toHaveBeenCalledWith(1, SAVE)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('↓ and ↑ just move when nothing was typed, so rows can be walked with the editor open (D31)', async () => {
    const { onMove, onSave } = setup()
    await userEvent.keyboard('{ArrowDown}')
    expect(onMove).toHaveBeenLastCalledWith(1, null)
    await userEvent.keyboard('{ArrowUp}')
    expect(onMove).toHaveBeenLastCalledWith(-1, null)
    expect(onSave).not.toHaveBeenCalled()
  })

  // Owner ruling 2026-10-03 (sitting A, A18): every exit ↓ handles saves first, ↑ included. This
  // replaces Decision 6's "↑ does nothing once something is typed".
  it('↑ saves and moves to the previous row, exactly like ↓ (sitting A, A18)', async () => {
    const { onMove, onSave } = setup()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{ArrowUp}')
    expect(onMove).toHaveBeenCalledWith(-1, SAVE)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Esc cancels', async () => {
    const { onCancel } = setup()
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('will not save without a required reason, and says why', async () => {
    const { onSave } = setup({ policy: REASON_POLICY.round3_ask, amountLabel: 'Round 3 ask' })
    await userEvent.type(screen.getByLabelText('Round 3 ask'), '400{Enter}')
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Statement of need is required')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Statement of need'), 'Lost a job in March{Enter}')
    expect(onSave).toHaveBeenCalledWith({ amount: 400, reason: 'Lost a job in March' })
  })

  it('will not save an amount it cannot read', async () => {
    const { onSave } = setup()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '12.345{Enter}')
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Cents go to two places')).toBeInTheDocument()
  })

  // Ruling 2026-10-01 (plan review), finding 4: once, with no re-render in between.
  it('saves once when Enter is pressed twice in a row (Review Focus 5)', async () => {
    const { onSave } = setup()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{Enter}{Enter}')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('saves once while Enter is held down (key repeat)', async () => {
    const { onSave } = setup()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500')
    await userEvent.keyboard('{Enter>3/}')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('ignores a repeated Enter even after a save has finished', async () => {
    const { onSave, rerender, ...props } = setup()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{Enter}')
    rerender(<RequestEditor {...props} onSave={onSave} saving />)
    rerender(<RequestEditor {...props} onSave={onSave} saving={false} />)
    fireEvent.keyDown(screen.getByLabelText('Round 2 ask'), { key: 'Enter', repeat: true })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('will not save while a save is on its way', async () => {
    const { onSave } = setup({ saving: true })
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{Enter}')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves again once the person edits after a save', async () => {
    const { onSave } = setup()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{Enter}0{Enter}')
    expect(onSave).toHaveBeenNthCalledWith(2, { amount: 25000, reason: 'Family emailed (Apr 9)' })
  })

  it('says a Round 3 above the limit goes to finance (D79)', () => {
    setup({ preview: { ...READY, pendingApproval: true } })
    expect(screen.getByText('Pending approval')).toBeInTheDocument()
  })

  it('says when it is working the award out, and when it could not', () => {
    const { rerender, ...props } = setup({ preview: { status: 'loading' } })
    expect(screen.getByText('Working it out…')).toBeInTheDocument()
    rerender(
      <RequestEditor {...props} preview={{ status: 'error', error: 'This request is on hold' }} />
    )
    expect(screen.getByText('This request is on hold')).toBeInTheDocument()
  })

  it('shows a payer with no chip or name as "Another household", never a raw id', () => {
    setup({
      preview: { ...READY, shares: [{ householdCmId: 1000009, pct: 100, amount: 1000 }] },
    })
    expect(screen.getByText('Another household')).toBeInTheDocument()
    expect(screen.queryByText(/1000009/)).toBeNull()
  })

  it('shows a name without a chip as plain text', () => {
    setup({
      preview: {
        ...READY,
        shares: [{ householdCmId: 1000009, householdName: 'Chen', pct: 100, amount: 1000 }],
      },
    })
    expect(screen.getByText('Chen')).toBeInTheDocument()
  })

  describe('what counts as typed (Decision 6; the baseline)', () => {
    it('follows a refetched amount while untouched, so ↓ just moves (I1a)', async () => {
      const { onMove, onSave, rerender, ...props } = setup({ initialAmount: 1200 })
      rerender(<RequestEditor {...props} onMove={onMove} onSave={onSave} initialAmount={1500} />)
      expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1500')
      await userEvent.keyboard('{ArrowDown}')
      expect(onMove).toHaveBeenCalledWith(1, null)
      expect(onSave).not.toHaveBeenCalled()
    })

    it('keeps what was typed when the amount is refetched under it', async () => {
      const { onMove, onSave, rerender, ...props } = setup({ initialAmount: 1200 })
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '0')
      rerender(<RequestEditor {...props} onMove={onMove} onSave={onSave} initialAmount={1500} />)
      expect(screen.getByLabelText('Round 2 ask')).toHaveValue('12000')
      await userEvent.keyboard('{ArrowDown}')
      expect(onMove).toHaveBeenCalledWith(1, { amount: 12000, reason: 'Family emailed (Apr 9)' })
    })

    it('reads "1,200" over 1200 as nothing typed (I1b)', async () => {
      const { onMove, onSave } = setup({ initialAmount: 1200 })
      const field = screen.getByLabelText('Round 2 ask')
      await userEvent.clear(field)
      await userEvent.type(field, '1,200{ArrowDown}')
      expect(onMove).toHaveBeenCalledWith(1, null)
      expect(onSave).not.toHaveBeenCalled()
    })

    it('after a save finishes, ↓ moves without writing it again (I1c)', async () => {
      const { onMove, onSave, rerender, ...props } = setup()
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{Enter}')
      expect(onSave).toHaveBeenCalledTimes(1)
      rerender(<RequestEditor {...props} onMove={onMove} onSave={onSave} saving />)
      rerender(<RequestEditor {...props} onMove={onMove} onSave={onSave} saving={false} />)
      await userEvent.keyboard('{ArrowDown}')
      expect(onMove).toHaveBeenCalledWith(1, null)
      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  describe('a save that fails stays retryable', () => {
    async function failedSave() {
      const view = setup()
      const { onMove, onSave, rerender, ...props } = view
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{Enter}')
      rerender(<RequestEditor {...props} onMove={onMove} onSave={onSave} saving />)
      rerender(
        <RequestEditor
          {...props}
          onMove={onMove}
          onSave={onSave}
          saving={false}
          saveError="Could not save"
        />
      )
      return { onMove, onSave }
    }

    it('keeps the typed value when the error arrives a render after saving ends', async () => {
      const { onMove, onSave, rerender, ...props } = setup()
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{Enter}')
      rerender(<RequestEditor {...props} onMove={onMove} onSave={onSave} saving />)
      rerender(<RequestEditor {...props} onMove={onMove} onSave={onSave} saving={false} />)
      rerender(
        <RequestEditor
          {...props}
          onMove={onMove}
          onSave={onSave}
          saving={false}
          saveError="Could not save"
        />
      )
      await userEvent.keyboard('{ArrowDown}')
      expect(onMove).toHaveBeenCalledWith(1, SAVE)
    })

    it('shows the error and keeps what was typed', async () => {
      await failedSave()
      expect(screen.getByText('Could not save')).toBeInTheDocument()
      expect(screen.getByLabelText('Round 2 ask')).toHaveValue('2500')
    })

    it('retries the save on ↓ instead of moving on without it', async () => {
      const { onMove } = await failedSave()
      await userEvent.keyboard('{ArrowDown}')
      expect(onMove).toHaveBeenCalledWith(1, SAVE)
    })

    it('retries the save on Enter', async () => {
      const { onSave } = await failedSave()
      await userEvent.keyboard('{Enter}')
      expect(onSave).toHaveBeenCalledTimes(2)
      expect(onSave).toHaveBeenLastCalledWith(SAVE)
    })
  })

  describe('keys', () => {
    it('ignores keys pressed with a modifier (M1)', async () => {
      const { onMove, onSave, onCancel } = setup()
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500')
      await userEvent.keyboard('{Shift>}{ArrowDown}{Enter}{Escape}{/Shift}')
      await userEvent.keyboard('{Control>}{Enter}{/Control}')
      expect(onMove).not.toHaveBeenCalled()
      expect(onSave).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()
    })

    it('ignores Meta and Alt on ↓ and Enter (M1)', async () => {
      const { onMove, onSave } = setup()
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500')
      await userEvent.keyboard('{Meta>}{ArrowDown}{Enter}{/Meta}')
      await userEvent.keyboard('{Alt>}{ArrowDown}{Enter}{/Alt}')
      expect(onMove).not.toHaveBeenCalled()
      expect(onSave).not.toHaveBeenCalled()
    })

    it('does not save and move on a held ↓ once something is typed (M2)', async () => {
      const { onMove, onSave } = setup()
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500')
      fireEvent.keyDown(screen.getByLabelText('Round 2 ask'), { key: 'ArrowDown', repeat: true })
      expect(onMove).not.toHaveBeenCalled()
      expect(onSave).not.toHaveBeenCalled()
    })

    it('ignores a key that confirms an IME composition (M1)', async () => {
      const { onSave } = setup()
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500')
      fireEvent.keyDown(screen.getByLabelText('Round 2 ask'), { key: 'Enter', isComposing: true })
      expect(onSave).not.toHaveBeenCalled()
    })

    it('does not walk rows while ↓ or ↑ is held down (M2)', () => {
      const { onMove } = setup()
      const field = screen.getByLabelText('Round 2 ask')
      fireEvent.keyDown(field, { key: 'ArrowDown', repeat: true })
      fireEvent.keyDown(field, { key: 'ArrowUp', repeat: true })
      expect(onMove).not.toHaveBeenCalled()
    })

    it('keeps the typed value and says why when ↓ meets an amount it cannot read (M4)', async () => {
      const { onMove, onSave } = setup()
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '12.345{ArrowDown}')
      expect(onMove).not.toHaveBeenCalled()
      expect(onSave).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Round 2 ask')).toHaveValue('12.345')
      expect(screen.getByText('Cents go to two places')).toBeInTheDocument()
    })

    it('reports null for an amount it cannot read (M4)', async () => {
      const { onAmountChange } = setup()
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '1x')
      expect(onAmountChange).toHaveBeenLastCalledWith(null)
    })

    it('keys the same from the note field (M4)', async () => {
      const { onMove, onSave } = setup()
      const note = screen.getByLabelText('Note')
      await userEvent.click(note)
      await userEvent.keyboard('{ArrowDown}')
      expect(onMove).toHaveBeenLastCalledWith(1, null)
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500')
      // ↑ is an exit like ↓ (sitting A, A18): it saves what is typed and moves back.
      await userEvent.type(note, '!{ArrowUp}')
      expect(onMove).toHaveBeenLastCalledWith(-1, {
        amount: 2500,
        reason: 'Family emailed (Apr 9)!',
      })
      await userEvent.type(note, '?{Enter}')
      expect(onSave).toHaveBeenCalledWith({ amount: 2500, reason: 'Family emailed (Apr 9)!?' })
    })
  })

  it('limits the note to what the server accepts (M6)', () => {
    setup()
    expect(screen.getByLabelText('Note')).toHaveAttribute('maxlength', '2000')
  })

  it('stacks its parts in the card layout (M3)', () => {
    setup({ layout: 'card' })
    const root = screen.getByText(/^Johnson · household/).parentElement
    expect(root).toHaveClass('flex', 'flex-col', 'items-start')
  })
})

// The grid's opened-row editor (owner fast-follow 10-03; full width under the detail text since §24,
// owner 10-09). One line holds the ask, Award / Stage, the note, Save Ask / Cancel and any `trailing`;
// the receipt, the payer shares and the key hint sit on the line under it. The detail line names the
// household, so the panel has no caption.
describe('RequestEditor: the panel layout (the grid)', () => {
  const top = () => screen.getByLabelText('Round 2 ask').closest('[data-editor-top]') as HTMLElement
  const foot = () => document.querySelector('[data-editor-foot]') as HTMLElement

  it('drops the family · household · person caption', () => {
    setup({ layout: 'panel' })
    expect(screen.queryByText(/household 1000001/)).toBeNull()
    expect(screen.queryByText(/person 1000002/)).toBeNull()
  })

  it('puts the ask, the award and stage, and the note on one line', () => {
    setup({ layout: 'panel' })
    const line = top()
    expect(line).toContainElement(screen.getByLabelText('Note'))
    expect(line).toContainElement(screen.getByText('Stage → Needs an offer'))
    expect(within(line).getByText(/^Award/)).toBeInTheDocument()
  })

  it('puts the receipt, the payer shares and the key hint on the line under it', () => {
    setup({ layout: 'panel' })
    const under = foot()
    expect(under).toContainElement(screen.getByText(/Enter saves/))
    expect(within(under).getByText(/60%/)).toBeInTheDocument()
    expect(within(top()).queryByText(/Enter saves/)).toBeNull()
    expect(within(top()).queryByText(/60%/)).toBeNull()
  })

  it('shows a problem in the figures slot on the first line once Enter is tried', async () => {
    setup({ layout: 'panel', preview: { status: 'idle' } })
    await userEvent.keyboard('{Enter}')
    expect(within(top()).getByText('Enter the Round 2 ask')).toBeInTheDocument()
  })

  // Design-language §24 (owner 10-09): Title Case buttons on the one row of fields, beside the reason.
  it('puts Save Ask and Cancel on the fields line, after the note, Title Case (§24)', () => {
    setup({ layout: 'panel' })
    const line = top()
    const save = within(line).getByRole('button', { name: 'Save Ask' })
    const cancel = within(line).getByRole('button', { name: 'Cancel' })
    const note = screen.getByLabelText('Note')
    expect(note.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(save.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Save Ask saves what is typed, once, and says why when it cannot (§24)', async () => {
    const { onSave } = setup({ layout: 'panel', preview: { status: 'idle' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Ask' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(within(top()).getByText('Enter the Round 2 ask')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    await userEvent.click(screen.getByRole('button', { name: 'Save Ask' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ amount: 1300, reason: 'Family emailed (Apr 9)' })
  })

  it('Cancel closes the editor, and Save Ask is off while a save is in flight (§24)', async () => {
    const { onCancel } = setup({ layout: 'panel' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('switches Save Ask off while saving', () => {
    setup({ layout: 'panel', saving: true })
    expect(screen.getByRole('button', { name: 'Save Ask' })).toBeDisabled()
  })

  it('keeps the caption in the card layout, where nothing else names the household', () => {
    setup({ layout: 'card' })
    expect(screen.getByText('Johnson · household 1000001 · person 1000002')).toBeInTheDocument()
  })
})

describe('draft and onDraftChange (owner rulings A and B, 2026-10-01)', () => {
  it('opens on a draft as typed: its text shows, and ↓ saves it', async () => {
    const { onMove } = setup({
      initialAmount: 300,
      draft: { raw: '450', reason: 'Family emailed (Apr 8)' },
    })
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('450')
    expect(screen.getByLabelText('Note')).toHaveValue('Family emailed (Apr 8)')
    await userEvent.keyboard('{ArrowDown}')
    expect(onMove).toHaveBeenCalledWith(1, { amount: 450, reason: 'Family emailed (Apr 8)' })
  })

  it('reports nothing typed, then the save it would make, then why it can’t', async () => {
    const onDraftChange = vi.fn()
    setup({ initialAmount: null, onDraftChange })
    expect(onDraftChange).toHaveBeenLastCalledWith(null)
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '500')
    expect(onDraftChange).toHaveBeenLastCalledWith({
      raw: '500',
      reason: 'Family emailed (Apr 9)',
      save: { amount: 500, reason: 'Family emailed (Apr 9)' },
      problem: null,
    })
    await userEvent.type(screen.getByLabelText('Round 2 ask'), ',5')
    expect(onDraftChange).toHaveBeenLastCalledWith({
      raw: '500,5',
      reason: 'Family emailed (Apr 9)',
      save: null,
      problem: 'Not an amount',
    })
  })

  it('reports nothing typed again once the amount is back where it opened', async () => {
    const onDraftChange = vi.fn()
    setup({ initialAmount: 300, onDraftChange })
    const input = screen.getByLabelText('Round 2 ask')
    await userEvent.clear(input)
    await userEvent.type(input, '350')
    expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ raw: '350' }))
    await userEvent.clear(input)
    await userEvent.type(input, '300')
    expect(onDraftChange).toHaveBeenLastCalledWith(null)
  })

  it('names a required reason left empty as the problem, with no save', async () => {
    const onDraftChange = vi.fn()
    setup({ policy: REASON_POLICY.round3_ask, amountLabel: 'Round 3 ask', onDraftChange })
    await userEvent.type(screen.getByLabelText('Round 3 ask'), '450')
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ save: null, problem: 'Statement of need is required' })
    )
  })

  it('shows its own problem when the surface asks, once, and not as a save error (M9)', () => {
    const { rerender, ...props } = setup({
      policy: REASON_POLICY.round3_ask,
      amountLabel: 'Round 3 ask',
      initialAmount: 450,
    })
    expect(screen.queryByText('Statement of need is required')).toBeNull()
    rerender(<RequestEditor {...props} showProblem />)
    expect(screen.getAllByText('Statement of need is required')).toHaveLength(1)
  })

  it('does not report again when only the callback is new', () => {
    const first = vi.fn()
    const { rerender, ...props } = setup({ onDraftChange: first })
    const second = vi.fn()
    rerender(<RequestEditor {...props} onDraftChange={second} />)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })
})

// Round 3 (household mock section 2, option B): the household card lays the editor out itself in two
// columns. `frame` hands it the parts; the grid never passes it, so its layouts are untouched.
describe('RequestEditor: a framed card (the household page lays it out)', () => {
  const frame = (render: (parts: EditorParts) => ReactNode = defaultFrame) => ({
    label: 'framed-label',
    amount: 'framed-amount',
    text: 'framed-text',
    area: 'framed-area',
    render,
  })
  const defaultFrame = (parts: EditorParts) => (
    <div>
      <div data-left="">
        {parts.amount}
        {parts.note}
      </div>
      <div data-right="">{parts.result}</div>
      <div data-foot="">
        {parts.problems}
        <span>{parts.keys}</span>
        <button type="button" onClick={parts.cancel}>
          Back
        </button>
        <button type="button" onClick={parts.save}>
          Save
        </button>
      </div>
    </div>
  )
  const right = () => document.querySelector('[data-right]') as HTMLElement
  const foot = () => document.querySelector('[data-foot]') as HTMLElement

  it('hands the surface its parts, and draws no caption or hint of its own', () => {
    setup({ layout: 'card', frame: frame(), onMove: undefined })
    expect(screen.queryByText(/household 1000001/)).toBeNull()
    expect(right()).toHaveTextContent('Award')
    expect(within(foot()).getByText('Enter saves · Esc cancels')).toBeInTheDocument()
    expect(screen.getAllByText(/Enter saves/)).toHaveLength(1)
  })

  it("dresses the fields in the surface's classes, labels above", () => {
    setup({ layout: 'card', frame: frame(), onMove: undefined })
    expect(screen.getByLabelText('Round 2 ask')).toHaveClass('framed-amount')
    expect(screen.getByLabelText('Round 2 ask')).not.toHaveClass('bg-background')
    expect(screen.getByLabelText('Note')).toHaveClass('framed-text')
    expect(screen.getByLabelText('Note').closest('label')).toHaveClass('framed-label')
  })

  it('gives the statement of need three rows and its Shift+Enter in the key hint', () => {
    setup({
      layout: 'card',
      frame: frame(),
      onMove: undefined,
      policy: REASON_POLICY.round3_ask,
      amountLabel: 'Round 3 ask',
    })
    const box = screen.getByLabelText('Statement of need')
    expect(box).toHaveAttribute('rows', '3')
    expect(box).toHaveClass('framed-area')
    expect(
      within(foot()).getByText('Enter saves · Shift+Enter for a new line · Esc cancels')
    ).toBeInTheDocument()
  })

  it('saves from its save once, as Enter does, and refuses what Enter would', async () => {
    const { onSave } = setup({ layout: 'card', frame: frame(), onMove: undefined })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(within(foot()).getByText('Enter the Round 2 ask')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '500')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ amount: 500, reason: 'Family emailed (Apr 9)' })
  })

  it('cancels from its cancel', async () => {
    const { onCancel } = setup({ layout: 'card', frame: frame(), onMove: undefined })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it("shows a failed save's words among the problems", () => {
    setup({ layout: 'card', frame: frame(), onMove: undefined, saveError: 'The server said no' })
    expect(within(foot()).getByText('The server said no')).toBeInTheDocument()
  })
})

// Owner Rev 3 wording ruling (10-10): the refusal keeps the amount label's own case, "Enter the Round 3
// ask", never the lowercased "round 3 ask". (The three "Enter the Round 2 ask" pins above changed under it.)
describe('RequestEditor: the Rev 3 refusal wording', () => {
  it('keeps the amount label as written', async () => {
    setup({ layout: 'card', amountLabel: 'Round 3 ask', policy: REASON_POLICY.round3_ask })
    await userEvent.type(screen.getByLabelText('Statement of need'), 'x{Enter}')
    expect(screen.getByText('Enter the Round 3 ask')).toBeInTheDocument()
  })
})

describe('RequestEditor: the Pending approval pill is amber (Rev 3)', () => {
  it('wears the hold tone, not the Round 3 purple, in the card result', () => {
    setup({ preview: { ...READY, pendingApproval: true } })
    const pill = screen.getByText('Pending approval')
    expect(pill.className).toMatch(/amber/)
    expect(pill.className).not.toMatch(/purple/)
  })
  it('wears it in the panel too', () => {
    setup({ layout: 'panel', preview: { ...READY, pendingApproval: true } })
    expect(screen.getByText('Pending approval').className).toMatch(/amber/)
  })
})

// Conformance #g6 (owner 10-10): a grid frame draws the caption and the control as separate grid
// cells (EditorField), so the household card's EditorGrid can lay them label · field.
describe('RequestEditor: a grid frame (caption and control apart)', () => {
  const gridFrame = {
    grid: true,
    label: 'unused',
    amount: 'g-amount',
    text: 'g-text',
    area: 'g-area',
    render: (parts: EditorParts) => (
      <div>
        <div data-grid="">
          {parts.amount}
          {parts.note}
        </div>
        <span data-keys="">{parts.keys}</span>
        <span data-words="">{parts.problemWords.join('|')}</span>
        <button type="button" onClick={parts.save}>
          Save
        </button>
      </div>
    ),
  } as const

  it('keeps the caption out of a <label> and names the control with aria-label', () => {
    setup({ layout: 'card', frame: gridFrame, onMove: undefined })
    const ask = screen.getByLabelText('Round 2 ask')
    expect(ask).toHaveClass('g-amount')
    expect(ask.closest('label')).toBeNull()
    expect(screen.getByText('Round 2 ask', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByLabelText('Note')).toHaveClass('g-text')
    expect(screen.getByLabelText('Note').closest('label')).toBeNull()
  })

  it("top-aligns the statement of need's caption", () => {
    setup({
      layout: 'card',
      frame: gridFrame,
      onMove: undefined,
      policy: REASON_POLICY.round3_ask,
      amountLabel: 'Round 3 ask',
    })
    expect(screen.getByText('Statement of need', { selector: 'span' })).toHaveClass('self-start')
    expect(screen.getByText('Round 3 ask', { selector: 'span' })).not.toHaveClass('self-start')
  })

  it('hands over the refusal words as text', async () => {
    setup({ layout: 'card', frame: gridFrame, onMove: undefined, saveError: 'No' })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(document.querySelector('[data-words]')).toHaveTextContent('Enter the Round 2 ask|No')
  })
})
