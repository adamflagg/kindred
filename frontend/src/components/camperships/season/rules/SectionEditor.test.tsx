import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { rulesVocabulary } from './rulesModel'
import { RULES_DOCUMENT, contentOf } from './rulesFixtures'
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
  it('Esc is Cancel, wherever focus is', async () => {
    const { onCancel, user } = setup()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores Esc while a save is running', async () => {
    const { onCancel, user } = setup({ saving: true })
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
  })

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

  it("shows a named award's kind as fixed words, never a box (the server refuses a change)", () => {
    const awards = contentOf('awards')
    const fund = {
      label: 'Named full-cost fund',
      kind: 'full_cost_after_aid',
      round: 1,
      amount: null,
      extra_amount: '0',
      allows_appeal: false,
      counts_toward_budget: false,
      ceiling_exempt: false,
    }
    setup({ opened: { ...awards, decision_types: { named_full_cost_fund: fund } } })
    expect(screen.getByText('Full cost after camp aid')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /kind/i })).toBeNull()
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
    await user.click(screen.getByRole('button', { name: 'Drop What Has Gone' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})

describe("SectionEditor reads the rules' own names, and still sends their keys (#15)", () => {
  it('names a pool by its label, keeps its label box, and saves under its key', async () => {
    const vocabulary = rulesVocabulary((section) => RULES_DOCUMENT[section])
    const { onSave, user } = setup({
      opened: contentOf('budget'),
      names: { section: 'budget', ...vocabulary },
    })
    expect(screen.getAllByText('Pool A').length).toBeGreaterThan(0)
    expect(screen.queryByText('pool_a')).toBeNull()
    expect(screen.getByText('Label')).toBeInTheDocument()
    const total = screen.getByLabelText('Total budget')
    await user.clear(total)
    await user.type(total, '900000')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({ ...contentOf('budget'), total: '900000' })
  })
})
