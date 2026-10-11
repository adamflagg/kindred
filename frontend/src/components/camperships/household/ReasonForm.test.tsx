import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ReasonForm } from './ReasonForm'

describe('ReasonForm (D22: these edits need a reason)', () => {
  it('opens focused, sends the trimmed note, and says a required one is missing', async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    render(
      <ReasonForm
        label="Release note"
        submitLabel="Release the Hold"
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    )
    expect(screen.getByLabelText('Release note')).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Release the Hold' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Release note is required')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Release note'), '  Checked with the family {Enter}')
    expect(onSubmit).toHaveBeenCalledWith('Checked with the family')
  })

  it("keeps the note and shows the server's refusal", async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error('Untick Accepted on Round 1 first')))
    render(
      <ReasonForm
        label="Why undo Posted"
        submitLabel="Undo Posted"
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    )
    await userEvent.type(screen.getByLabelText('Why undo Posted'), 'Wrong family{Enter}')
    expect(await screen.findByText('Untick Accepted on Round 1 first')).toBeInTheDocument()
    expect(screen.getByLabelText('Why undo Posted')).toHaveValue('Wrong family')
  })

  it('takes an empty note when it is optional, and Esc goes back', async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    const onCancel = vi.fn()
    render(
      <ReasonForm
        label="Note (optional)"
        required={false}
        submitLabel="Reopen"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(onSubmit).toHaveBeenCalledWith('')
    await userEvent.type(screen.getByLabelText('Note (optional)'), '{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })

  it('ignores a second submit while the first is in flight', () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => undefined))
    const { container } = render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={onSubmit} onCancel={() => undefined} />
    )
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Because' } })
    const form = container.querySelector('form') as HTMLFormElement
    act(() => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keeps the form open while a submit is in flight: Back is disabled and Esc does nothing', () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => undefined))
    const onCancel = vi.fn()
    const { container } = render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={onSubmit} onCancel={onCancel} />
    )
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Because' } })
    act(() => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    })
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('Why'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('a new submit clears the previous refusal', async () => {
    const onSubmit = vi
      .fn<(note: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Late refusal'))
      .mockResolvedValue(undefined)
    render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={onSubmit} onCancel={() => undefined} />
    )
    await userEvent.type(screen.getByLabelText('Why'), 'One{Enter}')
    expect(await screen.findByText('Late refusal')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Late refusal')).not.toBeInTheDocument()
  })

  it('closes on Esc as soon as it opens, with no click or focus first', async () => {
    const onCancel = vi.fn()
    render(<ReasonForm label="Why" submitLabel="Send" onSubmit={vi.fn()} onCancel={onCancel} />)
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

// Round 3 (mock section 2, option B): a form with a hint puts its fields on the left and the hint on
// the right; the footer puts the submit bottom right with Back beside it, after the key hint.
describe('ReasonForm: two columns and the footer (round 3)', () => {
  const side = () => document.querySelector('[data-editor-side]')

  it('puts its hint on the right, away from the field', () => {
    render(
      <ReasonForm
        label="Why"
        submitLabel="Send"
        hint="Undo returns the round to today's figure."
        onSubmit={vi.fn()}
        onCancel={() => undefined}
      />
    )
    expect(side()).toHaveTextContent("Undo returns the round to today's figure.")
    expect(side()).not.toContainElement(screen.getByLabelText('Why'))
  })

  it('keeps one column when it has no hint', () => {
    render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={vi.fn()} onCancel={() => undefined} />
    )
    expect(side()).toBeNull()
  })

  // Conformance #g6 (owner 10-10, rev 2: "the rest looks good"): the kit's one footer row replaces the
  // old footer. The action goes first, then Back, a refusal after Back, and the key hint at the row's end.
  it('puts the action first on one row, then Back, then the key hint at the end', () => {
    render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={vi.fn()} onCancel={() => undefined} />
    )
    const submit = screen.getByRole('button', { name: 'Send' })
    const back = screen.getByRole('button', { name: 'Back' })
    expect(submit.nextElementSibling).toBe(back)
    expect(submit.parentElement).toHaveClass('flex', 'flex-nowrap')
    const keys = submit.parentElement?.lastElementChild
    expect(keys).toHaveTextContent('Enter saves · Esc cancels')
    expect(keys).toHaveAttribute('title', 'Enter saves · Esc cancels')
    expect(submit).toHaveClass('h-[26px]')
  })

  it('shows a refusal after Back, cut with its words in a title', async () => {
    render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={vi.fn()} onCancel={() => undefined} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    const refusal = screen.getByText('Why is required')
    expect(screen.getByRole('button', { name: 'Back' }).nextElementSibling).toBe(refusal)
    expect(refusal).toHaveAttribute('title', 'Why is required')
    expect(refusal).toHaveClass('truncate')
  })

  it('draws the kit field beside its label, in the band-tinted card (it sits in a white card)', () => {
    render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={vi.fn()} onCancel={() => undefined} />
    )
    expect(screen.getByLabelText('Why')).toHaveClass('h-[30px]', 'bg-card')
    expect(screen.getByTestId('aid-editor-grid')).toHaveClass(
      'grid-cols-[max-content_minmax(0,1fr)]'
    )
    const card = screen.getByTestId('aid-editor-form').parentElement
    expect(card?.className).toContain('var(--color-forest-200)_24%')
  })

  it('heads the card with what it does, as the uppercase panel head', () => {
    render(
      <ReasonForm
        head="Putting it on hold"
        label="Why"
        submitLabel="Put on Hold"
        onSubmit={vi.fn()}
        onCancel={() => undefined}
      />
    )
    expect(screen.getByText('Putting it on hold').closest('.uppercase')).not.toBeNull()
  })

  // Rev 3 (owner 10-10): a refusal can say its own words ("Say why you're refusing").
  it('says its own words for a missing reason when given them', async () => {
    render(
      <ReasonForm
        label="Why refuse"
        requiredWords="Say why you're refusing"
        submitLabel="Refuse"
        onSubmit={vi.fn()}
        onCancel={() => undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Refuse' }))
    expect(screen.getByText("Say why you're refusing")).toBeInTheDocument()
  })
})
