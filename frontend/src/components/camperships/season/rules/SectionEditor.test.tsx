import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { contentOf } from './rulesFixtures'
import { SectionEditor } from './SectionEditor'

function setup(props: Partial<Parameters<typeof SectionEditor>[0]> = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <SectionEditor
      opened={contentOf('awards')}
      heading="Draft v4"
      saving={false}
      error={null}
      onSave={onSave}
      onCancel={onCancel}
      {...props}
    />
  )
  return { onSave, onCancel, user: userEvent.setup() }
}

describe('SectionEditor', () => {
  it('has Save off until something changes, then sends the whole section', async () => {
    const { onSave, user } = setup()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const box = screen.getByLabelText('Minimum award')
    await user.clear(box)
    await user.type(box, '150')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(onSave).toHaveBeenCalledWith({ ...contentOf('awards'), minimum: '150' })
  })

  it('blocks Save on a box it cannot read and says what is wrong', async () => {
    const { onSave, user } = setup()
    const box = screen.getByLabelText('Minimum award')
    await user.clear(box)
    await user.type(box, '10.505')
    expect(screen.getByText('Cents go to two places')).toBeInTheDocument()
    expect(
      screen.getByText('Fix first: Minimum award (Cents go to two places)')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('flips a yes/no and shows what it was', async () => {
    const { onSave, user } = setup()
    await user.click(screen.getByLabelText('The ask caps the award'))
    expect(screen.getByText('was yes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({ ...contentOf('awards'), ask_cap: false })
  })

  it('holds Save back when the home says so, and shows its banner and error', () => {
    setup({ canSave: false, error: 'Someone else saved first', banner: () => <p>Look first</p> })
    expect(screen.getByText('Look first')).toBeInTheDocument()
    expect(screen.getByText('Someone else saved first')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('cancels', async () => {
    const { onCancel, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows Saving and holds Cancel while saving (m9)', () => {
    setup({ saving: true })
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('clears an optional box to null, and a figure typed back turns Save off (m9)', async () => {
    const { onSave, user } = setup({ opened: contentOf('round3') })
    const box = screen.getByLabelText("The registrar's limit")
    await user.clear(box)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({ ...contentOf('round3'), registrar_limit: null })
    await user.type(box, '300.00')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('round-trips a choice (m9)', async () => {
    const { onSave, user } = setup({ opened: contentOf('grants') })
    await user.selectOptions(screen.getByLabelText('Offset mode'), 'reduce_cost_basis')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      ...contentOf('grants'),
      offset_mode: 'reduce_cost_basis',
    })
  })

  it('keeps what was typed across a rebase, and flags a row that went (m9, I3)', async () => {
    const tiers = contentOf('tiers')
    const user = userEvent.setup()
    const props = {
      heading: 'Draft v4',
      saving: false,
      error: null,
      onSave: vi.fn(),
      onCancel: vi.fn(),
    }
    const { rerender } = render(<SectionEditor opened={tiers} {...props} />)
    await user.type(screen.getByLabelText('Income bands › 3 › To'), '99000')
    await user.clear(screen.getByLabelText('Income bands › 2 › To'))
    await user.type(screen.getByLabelText('Income bands › 2 › To'), '75000')
    rerender(<SectionEditor opened={{ ...tiers, floor_tier: 2 }} {...props} />)
    expect(screen.getByLabelText('Income bands › 2 › To')).toHaveValue('75000')
    rerender(
      <SectionEditor
        opened={{
          ...tiers,
          bands: [
            { lower: '0', upper: '40000' },
            { lower: '40001', upper: '70000' },
          ],
        }}
        {...props}
      />
    )
    expect(screen.getByText(/Row 3 of Income bands is gone; retype it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Drop what has gone' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
