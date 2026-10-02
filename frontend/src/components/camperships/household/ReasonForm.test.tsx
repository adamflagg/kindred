import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ReasonForm } from './ReasonForm'

describe('ReasonForm (D22: these edits need a reason)', () => {
  it('opens focused, sends the trimmed note, and says a required one is missing', async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    render(
      <ReasonForm
        label="Release note"
        submitLabel="Release the hold"
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    )
    expect(screen.getByLabelText('Release note')).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Release the hold' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Release note is required')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Release note'), '  Checked with the family {Enter}')
    expect(onSubmit).toHaveBeenCalledWith('Checked with the family')
  })

  it("keeps the note and shows the server's refusal", async () => {
    const onSubmit = vi.fn(() =>
      Promise.reject(new Error('Round 1 is accepted: untick Accepted first'))
    )
    render(
      <ReasonForm
        label="Why undo Posted"
        submitLabel="Undo Posted"
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    )
    await userEvent.type(screen.getByLabelText('Why undo Posted'), 'Wrong family{Enter}')
    expect(
      await screen.findByText('Round 1 is accepted: untick Accepted first')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Why undo Posted')).toHaveValue('Wrong family')
  })

  it('takes an empty note when it is optional, and Esc goes back', async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    const onCancel = vi.fn()
    render(
      <ReasonForm
        label="Why reopen (optional)"
        required={false}
        submitLabel="Reopen"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(onSubmit).toHaveBeenCalledWith('')
    await userEvent.type(screen.getByLabelText('Why reopen (optional)'), '{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })

  it('ignores a second submit while the first is in flight', async () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => undefined))
    render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={onSubmit} onCancel={() => undefined} />
    )
    await userEvent.type(screen.getByLabelText('Why'), 'Because{Enter}')
    await userEvent.type(screen.getByLabelText('Why'), '{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not show an error from an older submit that lands after a newer one', async () => {
    let rejectFirst: (reason: Error) => void = () => undefined
    const onSubmit = vi
      .fn<(note: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => (rejectFirst = reject)))
      .mockImplementation(() => Promise.resolve())
    render(
      <ReasonForm label="Why" submitLabel="Send" onSubmit={onSubmit} onCancel={() => undefined} />
    )
    await userEvent.type(screen.getByLabelText('Why'), 'One{Enter}')
    // The first is still pending; a second submit is ignored while busy, so the late rejection
    // is the only error to land and it belongs to the current submit, not a stale one.
    rejectFirst(new Error('Late refusal'))
    expect(await screen.findByText('Late refusal')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Late refusal')).not.toBeInTheDocument()
  })
})
