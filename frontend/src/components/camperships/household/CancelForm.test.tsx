import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CancelForm } from './CancelForm'

describe('CancelForm (D101, D141)', () => {
  it("offers D141's nine reasons, and needs a note only for another reason", async () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    render(
      <CancelForm
        initial={null}
        submitLabel="Cancel the request"
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    )
    expect(screen.getAllByRole('option')).toHaveLength(10)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the request' }))
    expect(screen.getByText('Pick a cancel reason')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.selectOptions(screen.getByLabelText('Cancel reason'), 'another_reason')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the request' }))
    expect(screen.getByText('"another reason" needs a note')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Note'), 'Moved away')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the request' }))
    expect(onSubmit).toHaveBeenCalledWith('another_reason', 'Moved away')
  })

  it('opens on the reason already given', () => {
    render(
      <CancelForm
        initial={{ reason: 'medical', note: '' }}
        submitLabel="Save the reason"
        onSubmit={() => Promise.resolve()}
        onCancel={() => undefined}
      />
    )
    expect(screen.getByLabelText('Cancel reason')).toHaveValue('medical')
  })

  it('keeps the form and shows the refusal when the save fails', async () => {
    render(
      <CancelForm
        initial={{ reason: 'medical', note: '' }}
        submitLabel="Save the reason"
        onSubmit={() => Promise.reject(new Error('Refused'))}
        onCancel={() => undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save the reason' }))
    expect(await screen.findByText('Refused')).toBeInTheDocument()
    expect(screen.getByLabelText('Cancel reason')).toHaveValue('medical')
  })
})
