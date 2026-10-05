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

  it('ends its footer with Back and then the submit, after the key hint', () => {
    render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={vi.fn()} onCancel={() => undefined} />
    )
    const submit = screen.getByRole('button', { name: 'Send' })
    const back = screen.getByRole('button', { name: 'Back' })
    expect(submit.parentElement?.lastElementChild).toBe(submit)
    expect(back.nextElementSibling).toBe(submit)
    expect(back.previousElementSibling).toHaveTextContent('Enter saves · Esc cancels')
  })

  it('draws a white field', () => {
    render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={vi.fn()} onCancel={() => undefined} />
    )
    expect(screen.getByLabelText('Why')).toHaveClass('bg-white')
  })
})
