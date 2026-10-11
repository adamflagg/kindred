import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { aidPicked, aidPicker, aidOptions, chooseAid } from '../../../test/aidPicker'
import { CancelForm } from './CancelForm'

describe('CancelForm (D101, D141)', () => {
  it("offers D141's nine reasons, and needs a note only for another reason", async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    render(
      <CancelForm
        initial={null}
        submitLabel="Cancel the Request"
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    )
    // The kit picker (conformance gap 1): the nine reasons after "Pick a reason", as the native select had.
    expect(await aidOptions('Cancel reason')).toHaveLength(10)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the Request' }))
    expect(screen.getByText('Pick a cancel reason')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    await chooseAid('Cancel reason', 'another reason')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the Request' }))
    expect(screen.getByText('"another reason" needs a note')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Note'), 'Moved away')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the Request' }))
    expect(onSubmit).toHaveBeenCalledWith('another_reason', 'Moved away')
  })

  it('opens on the reason already given', () => {
    render(
      <CancelForm
        initial={{ reason: 'medical', note: '' }}
        submitLabel="Save the Reason"
        onSubmit={() => Promise.resolve()}
        onCancel={() => undefined}
      />
    )
    expect(aidPicked('Cancel reason')).toBe('medical')
  })

  it('keeps the form and shows the refusal when the save fails', async () => {
    render(
      <CancelForm
        initial={{ reason: 'medical', note: '' }}
        submitLabel="Save the Reason"
        onSubmit={() => Promise.reject(new Error('Refused'))}
        onCancel={() => undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save the Reason' }))
    expect(await screen.findByText('Refused')).toBeInTheDocument()
    expect(aidPicked('Cancel reason')).toBe('medical')
  })

  it('keeps the form open while a submit is in flight: Back is disabled and Esc does nothing', async () => {
    const onCancel = vi.fn()
    render(
      <CancelForm
        initial={null}
        submitLabel="Cancel the Request"
        onSubmit={() => new Promise<void>(() => undefined)}
        onCancel={onCancel}
      />
    )
    await chooseAid('Cancel reason', 'medical')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel the Request' }))
    })
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('closes on Esc as soon as it opens, with no click or focus first', async () => {
    const onCancel = vi.fn()
    render(
      <CancelForm
        initial={null}
        submitLabel="Cancel the Request"
        onSubmit={() => Promise.resolve()}
        onCancel={onCancel}
      />
    )
    expect(aidPicker('Cancel reason')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('CancelForm: two columns (round 3)', () => {
  it('says on the right which reason needs a note', () => {
    render(
      <CancelForm
        initial={null}
        submitLabel="Cancel the Request"
        onSubmit={() => Promise.resolve()}
        onCancel={() => undefined}
      />
    )
    const side = document.querySelector('[data-editor-side]')
    expect(side).toHaveTextContent('A note is needed only for "another reason".')
    expect(side).not.toContainElement(aidPicker('Cancel reason'))
    expect(side).not.toContainElement(screen.getByLabelText('Note'))
  })
})
