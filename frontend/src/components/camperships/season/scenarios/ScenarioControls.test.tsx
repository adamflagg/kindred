import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { campToday } from '../../kit/dates'
import { ScenarioControls } from './ScenarioControls'

type Props = ComponentProps<typeof ScenarioControls>

/** Re-renders the last `setup` with some props changed, as a refetch would. */
let again: (over: Partial<Props>) => void = () => undefined

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    panel: 'sandbox',
    compareCount: 0,
    onPanel: vi.fn(),
    pill: '180 applications · as of Feb 3, 2:10 pm',
    nothingNew: null,
    onUpdate: vi.fn(),
    price: { kind: 'all' },
    onPrice: vi.fn(),
    start: [
      { value: 'rules', label: 'Rules in effect · v4', disabled: false },
      { value: 'last_rules', label: "Last season's rules", disabled: false },
    ],
    fromCode: 'B',
    loadedCode: 'B',
    builtOn: null,
    chips: [
      { code: 'A', name: 'Tiers 3–5 +5%', loaded: false },
      { code: 'B', name: 'Minimum $75', loaded: true },
    ],
    unkept: 0,
    onLoad: vi.fn(),
    canEdit: true,
    onRename: vi.fn(),
    changes: null,
    onDiscard: vi.fn(),
    keep: { enabled: false, prefill: '', nextCode: 'C', figure: '' },
    onKeep: vi.fn(),
    promote: null,
    onPromote: vi.fn(),
    compareTools: null,
    error: null,
    ...over,
  }
  const view = render(<ScenarioControls {...props} />)
  again = (next) => view.rerender(<ScenarioControls {...props} {...next} />)
  return props
}

describe('the control line (§S5 A)', () => {
  it('holds the pile’s pill and Update Applications, always enabled, with "Nothing new since"', async () => {
    const props = setup({ nothingNew: 'Nothing new since Feb 3, 2:10 pm' })
    expect(screen.getByText('180 applications · as of Feb 3, 2:10 pm')).toBeInTheDocument()
    expect(screen.getByText('Nothing new since Feb 3, 2:10 pm')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Update Applications' }))
    expect(props.onUpdate).toHaveBeenCalledOnce()
  })

  it('switches Sandbox and Compare, Compare carrying its count', async () => {
    const props = setup({ compareCount: 2 })
    await userEvent.click(screen.getByRole('button', { name: 'Compare 2' }))
    expect(props.onPanel).toHaveBeenCalledWith('compare')
  })

  it('sets the request set from Price ▾, a date with its own box', async () => {
    const props = setup()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Price' }), 'deadline')
    expect(props.onPrice).toHaveBeenCalledWith({ kind: 'deadline' })
  })

  it('prices through a date that opens on today, and the date box beside it moves it (disagreement 15)', async () => {
    const props = setup()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Price' }), 'date')
    expect(props.onPrice).toHaveBeenLastCalledWith({ kind: 'date', date: campToday() })
    again({ price: { kind: 'date', date: '2027-02-01' } })
    fireEvent.change(screen.getByLabelText('Price through'), { target: { value: '2027-02-10' } })
    expect(props.onPrice).toHaveBeenLastCalledWith({ kind: 'date', date: '2027-02-10' })
  })

  it('shows "‹code›, kept" while a kept option is loaded, and loads a start from the menu', async () => {
    const props = setup()
    const start = screen.getByRole('combobox', { name: 'Start from' })
    expect(within(start).getByRole('option', { name: 'B, kept' })).toBeDisabled()
    await userEvent.selectOptions(start, 'last_rules')
    expect(props.onLoad).toHaveBeenCalledWith({ start: 'last_rules' })
  })

  it('loads a chip, filled when loaded, and says nothing is kept when nothing is', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: /^A Tiers 3–5 \+5%$/ }))
    expect(props.onLoad).toHaveBeenCalledWith({ option: 'A' })
  })

  it('asks before a load drops unkept changes (§S5 C)', async () => {
    const props = setup({ unkept: 3, changes: '3 changes' })
    await userEvent.click(screen.getByRole('button', { name: /^A Tiers/ }))
    const guard = screen.getByTestId('load-guard')
    expect(
      within(guard).getByText("3 changes aren't kept. Loading A drops them.")
    ).toBeInTheDocument()
    await userEvent.click(within(guard).getByRole('button', { name: 'Drop and Load A' }))
    expect(props.onLoad).toHaveBeenCalledWith({ option: 'A' })
  })

  it('says "isn’t" and "it" for one unkept change (V F5)', async () => {
    setup({ unkept: 1, changes: '1 change' })
    await userEvent.click(screen.getByRole('button', { name: /^A Tiers/ }))
    expect(
      within(screen.getByTestId('load-guard')).getByText("1 change isn't kept. Loading A drops it.")
    ).toBeInTheDocument()
  })

  it('opens Keep… from the guard in Compare too, where the chips also load (§S5 C: "Keep… (opens B)")', async () => {
    const props = setup({
      panel: 'compare',
      unkept: 3,
      changes: '3 changes',
      keep: { enabled: true, prefill: 'Minimum $75', nextCode: 'C', figure: '' },
    })
    await userEvent.click(screen.getByRole('button', { name: /^A Tiers/ }))
    await userEvent.click(
      within(screen.getByTestId('load-guard')).getByRole('button', { name: 'Keep…' })
    )
    const pop = screen.getByTestId('keep-popover')
    await userEvent.type(within(pop).getByRole('textbox', { name: 'Name' }), '{Enter}')
    expect(props.onKeep).toHaveBeenCalledWith('Minimum $75')
  })

  it('offers the guard’s Keep… only when Keep… itself is on (same as a kept option, nothing held)', async () => {
    setup({ unkept: 3, changes: '3 changes, same as A' })
    await userEvent.click(screen.getByRole('button', { name: /^A Tiers/ }))
    const guard = screen.getByTestId('load-guard')
    expect(within(guard).getByRole('button', { name: 'Keep…' })).toBeDisabled()
    expect(within(guard).getByRole('button', { name: 'Drop and Load A' })).toBeEnabled()
  })

  it('renames the loaded chip on Enter or leaving the box; Esc cancels; a blank name is not sent (§S5 D)', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Rename B' }))
    const box = screen.getByRole('textbox', { name: 'Name of B' })
    await userEvent.clear(box)
    await userEvent.type(box, 'Higher minimum{Enter}')
    expect(props.onRename).toHaveBeenCalledWith('B', 'Higher minimum')
    await userEvent.click(screen.getByRole('button', { name: 'Rename B' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Name of B' }))
    await userEvent.tab()
    expect(props.onRename).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Rename B' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name of B' }), 'x{Escape}')
    expect(props.onRename).toHaveBeenCalledOnce()
  })

  it('shows the change count, Discard Changes and Make B the Rules Draft… when the server allows it', async () => {
    const props = setup({ changes: '4 changes, same as A', promote: 'B' })
    expect(screen.getByText('4 changes, same as A')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Discard Changes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Make B the Rules Draft…' }))
    expect([props.onDiscard, props.onPromote].map((f) => vi.mocked(f).mock.calls.length)).toEqual([
      1, 1,
    ])
  })

  it('keeps with a prefilled name, Enter keeping, and says what it prices now (§S5 B)', async () => {
    const props = setup({
      keep: {
        enabled: true,
        prefill: 'Minimum $75',
        nextCode: 'C',
        figure: 'with what it prices now: $315,913 on 180 applications',
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Keep…' }))
    const pop = screen.getByTestId('keep-popover')
    expect(within(pop).getByRole('textbox', { name: 'Name' })).toHaveValue('Minimum $75')
    expect(
      within(pop).getByText('with what it prices now: $315,913 on 180 applications')
    ).toBeInTheDocument()
    await userEvent.type(within(pop).getByRole('textbox', { name: 'Name' }), ' only{Enter}')
    expect(props.onKeep).toHaveBeenCalledWith('Minimum $75 only')
    expect(screen.queryByTestId('keep-popover')).toBeNull()
  })

  it('keeps a label longer than the name field as it was cut, never refused (plan review M3)', async () => {
    const long =
      'Round 1 % › Teen › Tier 2 75% · Minimum $150 · Round 1 + 2 cap › Teen › Tier 2 92%' // 82 characters
    const props = setup({ keep: { enabled: true, prefill: long, nextCode: 'C', figure: '' } })
    await userEvent.click(screen.getByRole('button', { name: 'Keep…' }))
    const box = within(screen.getByTestId('keep-popover')).getByRole('textbox', { name: 'Name' })
    expect(box).toHaveAttribute('maxLength', '80')
    await userEvent.type(box, '{Enter}')
    expect(props.onKeep).toHaveBeenCalledWith(
      'Round 1 % › Teen › Tier 2 75% · Minimum $150 · Round 1 + 2 cap › Teen › Tier 2 …'
    )
  })

  it('follows the label until the person types: the release Keep… waited on can land after it opened (plan review M3)', async () => {
    // From the implicit draft (nothing recorded yet, so the label is "no changes"), the first edit is still in its
    // box when Keep… is clicked: that release lands after the popover opened, and the label moves under it.
    const keep = { enabled: true, nextCode: 'A', figure: '' }
    setup({ keep: { ...keep, prefill: 'no changes' } })
    await userEvent.click(screen.getByRole('button', { name: 'Keep…' }))
    const box = () =>
      within(screen.getByTestId('keep-popover')).getByRole('textbox', { name: 'Name' })
    expect(box()).toHaveValue('no changes')
    again({ keep: { ...keep, prefill: 'Minimum $125' } })
    expect(box()).toHaveValue('Minimum $125')
    await userEvent.type(box(), ' only')
    again({ keep: { ...keep, prefill: 'Minimum $130' } })
    expect(box()).toHaveValue('Minimum $125 only') // once typed, the person's name stands
  })

  it('disables Keep… with no change, and shows a refusal as one amber line', () => {
    setup({
      error:
        'Round 1 award table is locked: Round 1 is posted, so Scenarios models only what is still open.',
    })
    expect(screen.getByRole('button', { name: 'Keep…' })).toBeDisabled()
    expect(screen.getByText(/Round 1 award table is locked/)).toBeInTheDocument()
  })
})
