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
    expect(screen.getByText('Fix the boxes marked above first.')).toBeInTheDocument()
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
})
