/**
 * Ignore… (adult aid form mock v2, steps 11–12): the kit's EditorForm in the opened row, a Why picker and a Reason,
 * what ignoring does, and Ignore Response switched off with "A reason is required" until a reason is picked.
 * Fictional data (adultFormFixtures).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CASEY } from './adultFormFixtures'
import { IgnoreResponseEditor } from './IgnoreResponseEditor'

function renderEditor(onIgnore = vi.fn(() => Promise.resolve()), onCancel = vi.fn()) {
  render(
    <IgnoreResponseEditor response={CASEY} year={2027} onIgnore={onIgnore} onCancel={onCancel} />
  )
  return { onIgnore, onCancel }
}

describe('Ignore…', () => {
  it('is titled with the typed name, and says what ignoring does', () => {
    renderEditor()
    expect(screen.getByText('Ignore a Response · “Casey Sam”')).toBeInTheDocument()
    expect(screen.getByText('Leaves Responses to link')).toBeInTheDocument()
    expect(
      screen.getByText('Never matched again, even if Casey Sam registers later')
    ).toBeInTheDocument()
  })

  it('keeps Ignore Response off, saying why, until a reason is picked', async () => {
    const { onIgnore } = renderEditor()
    const save = screen.getByRole('button', { name: 'Ignore Response' })
    expect(save).toBeDisabled()
    expect(screen.getByText('A reason is required')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Why/ }))
    await userEvent.click(screen.getByRole('option', { name: 'A test or junk response' }))
    expect(save).toBeEnabled()
    await userEvent.type(screen.getByLabelText('Reason'), "Ben's test before the form went out")
    await userEvent.click(save)
    expect(onIgnore).toHaveBeenCalledWith({
      kind: 'test',
      reason: "Ben's test before the form went out",
    })
  })

  it('Other needs words in Reason', async () => {
    renderEditor()
    await userEvent.click(screen.getByRole('button', { name: /Why/ }))
    await userEvent.click(screen.getByRole('option', { name: 'Other' }))
    expect(screen.getByRole('button', { name: 'Ignore Response' })).toBeDisabled()
    expect(screen.getByText('Say why in Reason')).toBeInTheDocument()
  })

  it('shows a refusal beside the buttons, and Esc cancels', async () => {
    const { onCancel } = renderEditor(
      vi.fn(() => Promise.reject(new Error('a reason is required')))
    )
    await userEvent.click(screen.getByRole('button', { name: /Why/ }))
    await userEvent.click(screen.getByRole('option', { name: 'A duplicate of another response' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ignore Response' }))
    expect(await screen.findByText('a reason is required')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Reason'), '{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})
