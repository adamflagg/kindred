import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { campToday } from '../../kit/dates'
import { ScenarioControls } from './ScenarioControls'

type Props = ComponentProps<typeof ScenarioControls>

/** Re-renders the last `setup` with some props changed, as a refetch would. */
let again: (over: Partial<Props>) => void = () => undefined

// Owner ruling 10-09 ("the stylized WHITE picker for every select"): Price and Start from are the kit picker.
async function pickPrice(label: string) {
  await userEvent.click(screen.getByRole('button', { name: /^Price:/ }))
  await userEvent.click(screen.getByRole('option', { name: label }))
}

async function openFrom() {
  await userEvent.click(screen.getByRole('button', { name: /^From:/ }))
}

async function pickKept() {
  await openFrom()
  await userEvent.click(screen.getByRole('option', { name: 'A · Tiers 3–5 +5%' }))
}

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    panel: 'sandbox',
    compareCount: 0,
    onPanel: vi.fn(),
    pill: '180 applications · as of Feb 3, 2:10 pm',
    lead: { held: '180 held', when: 'Feb 3, 2:10 pm' },
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
    refused: null,
    notice: null,
    error: null,
    ...over,
  }
  const view = render(<ScenarioControls {...props} />)
  again = (next) => view.rerender(<ScenarioControls {...props} {...next} />)
  return props
}

describe('the control line (§S5 A; scenarios-2): one kit toolbar row', () => {
  it('is the kit toolbar, with no Start from strip box and no kept chip strip', () => {
    setup()
    expect(screen.getAllByTestId('aid-toolbar')).toHaveLength(1)
    expect(screen.queryByTestId('start-strip')).toBeNull()
    expect(screen.queryByText('nothing kept yet')).toBeNull()
    expect(screen.getByTestId('aid-toolbar').className).not.toMatch(/flex-wrap/)
  })

  it('leads with "‹n› held" and its moment, the full pile sentence as the title, and Update Applications last', async () => {
    const props = setup()
    const lead = screen.getByText('180 held')
    expect(lead.closest('[title]')).toHaveAttribute(
      'title',
      '180 applications · as of Feb 3, 2:10 pm'
    )
    expect(screen.getByText('· Feb 3, 2:10 pm')).toBeInTheDocument()
    const buttons = within(screen.getByTestId('aid-toolbar')).getAllByRole('button')
    expect(buttons.at(-1)).toHaveTextContent('Update Applications')
    await userEvent.click(buttons.at(-1)!)
    expect(props.onUpdate).toHaveBeenCalledOnce()
  })

  it('leads with the plain words when nothing is held', () => {
    setup({
      lead: { held: 'No applications held yet', when: null },
      pill: 'No applications held yet',
    })
    expect(screen.getByText('No applications held yet')).toBeInTheDocument()
  })

  it('puts "Nothing new since" in the status slot, and an error as one amber status', () => {
    setup({ nothingNew: 'Nothing new since Feb 3, 2:10 pm' })
    expect(screen.getByText('Nothing new since Feb 3, 2:10 pm')).toBeInTheDocument()
    again({ nothingNew: null, error: 'Round 1 award table is locked.' })
    expect(screen.getByText('Round 1 award table is locked.')).toHaveClass('text-amber-700')
  })

  it('switches Sandbox and Compare as the kit segmented well, Compare carrying its count', async () => {
    const props = setup({ compareCount: 2 })
    expect(screen.getByRole('group', { name: 'Panel' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Compare 2' }))
    expect(props.onPanel).toHaveBeenCalledWith('compare')
  })

  it('sets the request set from Price ▾ in the short labels, a date with its own box', async () => {
    const props = setup()
    await pickPrice('Through the R1 deadline')
    expect(props.onPrice).toHaveBeenCalledWith({ kind: 'deadline' })
    expect(screen.getByRole('button', { name: 'Price: All held' })).toBeInTheDocument()
  })

  it('prices through a date that opens on today, and the date box beside it moves it (disagreement 15)', async () => {
    const props = setup()
    await pickPrice('Through a date…')
    expect(props.onPrice).toHaveBeenLastCalledWith({ kind: 'date', date: campToday() })
    again({ price: { kind: 'date', date: '2027-02-01' } })
    fireEvent.change(screen.getByLabelText('Price through'), { target: { value: '2027-02-10' } })
    expect(props.onPrice).toHaveBeenLastCalledWith({ kind: 'date', date: '2027-02-10' })
  })

  it('merges Start from and the kept chips into one From picker with two groups', async () => {
    const props = setup()
    expect(screen.getByRole('button', { name: 'From: B · Minimum $75' })).toBeInTheDocument()
    await openFrom()
    const groups = screen.getAllByRole('presentation').map((n) => n.textContent)
    expect(groups).toEqual(['Start from', 'Kept'])
    expect(screen.getAllByRole('option').map((o) => o.textContent.replace('✓', ''))).toEqual([
      'Rules in effect · v4',
      "Last season's rules",
      'A · Tiers 3–5 +5%',
      'B · Minimum $75',
    ])
    await userEvent.click(screen.getByRole('option', { name: "Last season's rules" }))
    expect(props.onLoad).toHaveBeenCalledWith({ start: 'last_rules' })
  })

  it('loads a kept option from the picker', async () => {
    const props = setup()
    await openFrom()
    await userEvent.click(screen.getByRole('option', { name: 'A · Tiers 3–5 +5%' }))
    expect(props.onLoad).toHaveBeenCalledWith({ option: 'A' })
  })

  it('has no Kept group, no ✎ and no Make … the Rules Draft… when nothing is kept (scenarios-m4)', async () => {
    setup({ chips: [], loadedCode: null, fromCode: 'rules' })
    expect(screen.getByRole('button', { name: 'From: Rules in effect · v4' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /the Rules Draft…$/ })).toBeNull()
    await openFrom()
    expect(screen.getAllByRole('presentation').map((n) => n.textContent)).toEqual(['Start from'])
  })

  it('carries "built on v4, v5 is in effect now" in the picker’s title', () => {
    setup({ builtOn: 'built on v4, v5 is in effect now' })
    expect(screen.getByRole('button', { name: /^From:/ })).toHaveAttribute(
      'title',
      expect.stringContaining('built on v4, v5 is in effect now')
    )
  })

  it('asks before a load drops unkept changes (§S5 C)', async () => {
    const props = setup({ unkept: 3, changes: '3 changes' })
    await pickKept()
    const guard = screen.getByTestId('load-guard')
    expect(
      within(guard).getByText("3 changes aren't kept. Loading A drops them.")
    ).toBeInTheDocument()
    await userEvent.click(within(guard).getByRole('button', { name: 'Drop and Load A' }))
    expect(props.onLoad).toHaveBeenCalledWith({ option: 'A' })
  })

  it('lays the guard out as the kit editor: the sentence, then the three Title Case buttons on one row (§24)', async () => {
    setup({
      unkept: 3,
      changes: '3 changes',
      keep: { enabled: true, prefill: 'x', nextCode: 'C', figure: '' },
    })
    await pickKept()
    const guard = screen.getByTestId('load-guard')
    expect(within(guard).getByTestId('aid-editor-form')).toBeInTheDocument()
    expect(
      within(guard)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Keep…', 'Drop and Load A', 'Cancel'])
    expect(within(guard).getAllByRole('button')[0]?.parentElement).toHaveClass('flex-nowrap')
  })

  it('says "isn’t" and "it" for one unkept change (V F5)', async () => {
    setup({ unkept: 1, changes: '1 change' })
    await pickKept()
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
    await pickKept()
    await userEvent.click(
      within(screen.getByTestId('load-guard')).getByRole('button', { name: 'Keep…' })
    )
    const pop = screen.getByTestId('keep-popover')
    await userEvent.type(within(pop).getByRole('textbox', { name: 'Name' }), '{Enter}')
    expect(props.onKeep).toHaveBeenCalledWith('Minimum $75')
  })

  it('offers the guard’s Keep… only when Keep… itself is on (same as a kept option, nothing held)', async () => {
    setup({ unkept: 3, changes: '3 changes, same as A' })
    await pickKept()
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

  it('lays Keep… out as the kit editor: Name in the two-column grid, the buttons and the figure on one row (§24)', async () => {
    setup({
      keep: {
        enabled: true,
        prefill: 'Minimum $75',
        nextCode: 'C',
        figure: 'with what it prices now: $1',
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Keep…' }))
    const pop = screen.getByTestId('keep-popover')
    expect(within(pop).getByTestId('aid-editor-grid')).toBeInTheDocument()
    const row = within(pop).getByRole('button', { name: 'Keep as C' }).parentElement
    expect(row).toHaveClass('flex-nowrap')
    expect(row).toHaveTextContent('Cancel')
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

  it('keeps Update Applications last in Compare too, after the compare tools, with the four-option refusal as status', () => {
    setup({
      panel: 'compare',
      compareTools: <button type="button">Print</button>,
      refused: 'Four kept options are already columns: uncheck one to add C.',
    })
    const buttons = within(screen.getByTestId('aid-toolbar')).getAllByRole('button')
    expect(buttons.at(-2)).toHaveTextContent('Print')
    expect(buttons.at(-1)).toHaveTextContent('Update Applications')
    expect(screen.getByText(/Four kept options are already columns/)).toHaveClass('text-amber-700')
    expect(screen.queryByRole('button', { name: 'Keep…' })).toBeNull()
  })

  it('shows a Compare refusal only in Compare, and the "isn’t kept" notice in the status slot, not as a row', () => {
    setup({
      refused: 'Four kept options are already columns: uncheck one to add C.',
      notice: "D isn't kept in 2027, so it was left out of the compare.",
    })
    expect(screen.queryByText(/Four kept options/)).toBeNull()
    expect(
      screen.getByText("D isn't kept in 2027, so it was left out of the compare.")
    ).toHaveClass('text-amber-700')
    expect(screen.getByTestId('aid-toolbar')).toContainElement(
      screen.getByText(/D isn't kept in 2027/)
    )
  })

  it('puts Update Applications after Keep… in the sandbox', () => {
    setup({
      keep: { enabled: true, prefill: 'x', nextCode: 'C', figure: '' },
      changes: '2 changes',
    })
    const buttons = within(screen.getByTestId('aid-toolbar'))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(buttons.slice(-3)).toEqual(['Discard Changes', 'Keep…', 'Update Applications'])
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
