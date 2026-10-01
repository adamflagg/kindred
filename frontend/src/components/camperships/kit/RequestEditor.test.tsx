import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { REASON_POLICY } from './editor'
import { TRACE_ROUND2_CAPPED } from './fixtures'
import { RequestEditor, type EditorPreview } from './RequestEditor'

const READY: EditorPreview = {
  status: 'ready',
  award: 1000,
  trace: TRACE_ROUND2_CAPPED,
  stageChange: 'Needs an offer',
  shares: [
    { householdCmId: 1000001, chip: 1, householdName: 'Johnson', pct: 60, amount: 600 },
    { householdCmId: 1000003, chip: 2, householdName: 'Garcia', pct: 40, amount: 400 },
  ],
}

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

  it('↑ does nothing once something is typed: no ruling says "save and move back" (Decision 6)', async () => {
    const { onMove, onSave } = setup()
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '2500{ArrowUp}')
    expect(onMove).not.toHaveBeenCalled()
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
      await userEvent.type(note, '!{ArrowUp}')
      expect(onMove).toHaveBeenCalledTimes(1)
      await userEvent.type(note, '{Enter}')
      expect(onSave).toHaveBeenCalledWith({ amount: 2500, reason: 'Family emailed (Apr 9)!' })
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
