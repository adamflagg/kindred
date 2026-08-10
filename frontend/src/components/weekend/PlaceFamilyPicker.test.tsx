/**
 * Placing a family from the space itself (kindred#2080).
 *
 * Two rulings are pinned here and neither is obvious from the code alone:
 *
 *  1. **The list is not rendered until the staff member engages the search
 *     box.** That is what makes an inline picker affordable — the card, and
 *     therefore the whole grid row, only grows once somebody has actually
 *     asked for it, so the resting board never moves. jsdom has no layout
 *     engine, so "unchanged in height" is pinned STRUCTURALLY: at rest the
 *     control renders no listbox and no option rows at all.
 *
 *  2. **The list annotates and orders. It never hides.** 6 of 118 units have a
 *     private bathroom against 63 parties asking for one, so filtering to
 *     "what fits" would leave staff unable to place anybody.
 *
 * The keyboard half is not a nicety either: a typeahead that only opened on a
 * pointer click would be a trap on a board that is already close to
 * pointer-only.
 *
 * Fictional data throughout.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { PlaceFamilyPicker } from './PlaceFamilyPicker'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    power_coverage: 'none',
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: true,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    shareability: 'shareable',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    person_cm_id: 0,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    unit_codes: [],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

const JOHNSON = party()
const GARCIA = party({
  household_cm_id: 202,
  display_name: 'Garcia',
  sort_name: 'Garcia',
  adults: [{ adult_number: 1, display_name: 'Liam Garcia', relationship: 'Father' }],
  children: [{ person_cm_id: 9002, display_name: 'Mia Garcia', age: 6, grade: 1 }],
})

function renderPicker(props: Partial<Parameters<typeof PlaceFamilyPicker>[0]> = {}) {
  const onSelect = vi.fn()
  const view = render(
    <>
      {/* A preceding control, so `userEvent.tab()` has somewhere to start —
          the Tab-reachability claim is worthless asserted from nowhere. */}
      <button type="button">Before</button>
      <PlaceFamilyPicker
        unit={unit()}
        parties={[JOHNSON, GARCIA]}
        units={[]}
        onSelect={onSelect}
        {...props}
      />
    </>
  )
  return { ...view, onSelect }
}

function searchBox() {
  return screen.getByRole('combobox', { name: /place a family in cedar 1/i })
}

describe('PlaceFamilyPicker — at rest', () => {
  it('renders the search box and nothing else', () => {
    // The list is what would grow the card and shift the grid row. It must
    // not exist until somebody engages the control.
    renderPicker()
    expect(searchBox()).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('names no family before the list is opened', () => {
    renderPicker()
    expect(screen.queryByText(/Johnson/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Garcia/)).not.toBeInTheDocument()
  })
})

describe('PlaceFamilyPicker — opening', () => {
  it('opens the list when the search box is clicked', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.click(searchBox())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('opens the list on keyboard focus, so Tab is not a dead end', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.tab() // the "Before" button
    await user.tab() // the search box
    expect(searchBox()).toHaveFocus()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('says the list is closed until it is', async () => {
    const user = userEvent.setup()
    renderPicker()
    expect(searchBox()).toHaveAttribute('aria-expanded', 'false')
    await user.click(searchBox())
    expect(searchBox()).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('PlaceFamilyPicker — the list annotates and orders, never hides', () => {
  it('lists every unplaced party even when not one of them fits', async () => {
    // The ruling, as arithmetic: a hide-filter would empty this list.
    const user = userEvent.setup()
    renderPicker({
      parties: [
        party({ household_cm_id: 1, sort_name: 'Adams', flags: { needs_private_bathroom: true } }),
        party({ household_cm_id: 2, sort_name: 'Baker', flags: { needs_power: true } }),
        party({ household_cm_id: 3, sort_name: 'Cole', party_size: 40 }),
      ],
    })
    await user.click(searchBox())
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('annotates a misfit on its own row rather than removing it', async () => {
    const user = userEvent.setup()
    renderPicker({
      parties: [party({ flags: { needs_private_bathroom: true, needs_power: true } })],
    })
    await user.click(searchBox())
    const option = screen.getByRole('option')
    expect(option).toHaveTextContent('No private bathroom')
    expect(option).toHaveTextContent('No power')
  })

  it('orders the best fit first', async () => {
    const user = userEvent.setup()
    renderPicker({
      parties: [
        party({ household_cm_id: 1, sort_name: 'Zimmerman', flags: { needs_power: true } }),
        party({ household_cm_id: 2, sort_name: 'Adams' }),
      ],
      unit: unit({ power_coverage: 'none' }),
    })
    await user.click(searchBox())
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('data-fit', 'fits')
    expect(options[1]).toHaveAttribute('data-fit', 'unmet')
  })

  it('says nothing at all about a party that fits', async () => {
    const user = userEvent.setup()
    renderPicker({ parties: [JOHNSON], unit: unit({ power_coverage: 'all' }) })
    await user.click(searchBox())
    const option = screen.getByRole('option')
    expect(option).toHaveAttribute('data-fit', 'fits')
    expect(option).not.toHaveTextContent(/No power|No private bathroom|Over capacity/)
  })
})

describe('PlaceFamilyPicker — the row figure', () => {
  it('counts beds the way the capacity note does', async () => {
    /*
     * `party_size` is 0 for a party CampMinder never sized, and `partyBeds`
     * falls back to the headcount for exactly that case. A row reading
     * "0 beds" beside a note reading "needs 2" would be the same party
     * counted two ways on one line.
     */
    const user = userEvent.setup()
    renderPicker({
      parties: [
        party({
          party_size: 0,
          adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
          children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
        }),
      ],
      unit: unit({ sleeps: 1, power_coverage: 'all' }),
    })
    await user.click(searchBox())
    const option = screen.getByRole('option')
    expect(option).toHaveTextContent('2 beds')
    expect(option).toHaveTextContent('Over capacity · needs 2, sleeps 1')
  })
})

describe('PlaceFamilyPicker — choosing', () => {
  it('hands the clicked party back', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPicker()
    await user.click(searchBox())
    await user.click(screen.getByRole('option', { name: /Liam Garcia/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0]?.[0]).toEqual(GARCIA)
  })

  it('closes the list and clears the search once a family is chosen', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.click(searchBox())
    await user.type(searchBox(), 'Garcia')
    await user.click(screen.getByRole('option', { name: /Liam Garcia/ }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(searchBox()).toHaveValue('')
  })

  it('walks the list with the arrow keys and commits with Enter', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPicker()
    await user.click(searchBox())
    await user.keyboard('{ArrowDown}')
    const first = screen.getAllByRole('option')[0]
    expect(searchBox()).toHaveAttribute('aria-activedescendant', first?.id ?? 'missing')
    await user.keyboard('{ArrowDown}')
    const second = screen.getAllByRole('option')[1]
    expect(searchBox()).toHaveAttribute('aria-activedescendant', second?.id ?? 'missing')
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
    // Sorted by `sort_name`, so Garcia leads and Johnson is second.
    expect(onSelect.mock.calls[0]?.[0]).toEqual(JOHNSON)
  })

  it('walks back up the list', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPicker()
    await user.click(searchBox())
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}')
    expect(onSelect.mock.calls[0]?.[0]).toEqual(GARCIA)
  })

  it('commits nothing when Enter is pressed with no row active', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPicker()
    await user.click(searchBox())
    await user.keyboard('{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('PlaceFamilyPicker — closing', () => {
  it('closes on Escape and leaves focus on the search box', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.click(searchBox())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(searchBox()).toHaveFocus()
  })

  it('does not let Escape reach the board behind it', async () => {
    // The weekend board and its panels close on Escape too. A picker that let
    // the key through would close the surface the staff member is working in.
    const user = userEvent.setup()
    const onKeyDown = vi.fn()
    render(
      // A bare listener is the point: this stands in for the board behind the
      // card, which is not an interactive element either.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={onKeyDown}>
        <PlaceFamilyPicker unit={unit()} parties={[JOHNSON]} units={[]} onSelect={vi.fn()} />
      </div>
    )
    await user.click(searchBox())
    await user.keyboard('{Escape}')
    expect(onKeyDown).not.toHaveBeenCalled()
  })
})

describe('PlaceFamilyPicker — searching', () => {
  it('narrows to the typed name, adults and children alike', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.click(searchBox())
    await user.type(searchBox(), 'mia')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Garcia')
  })

  it('borrows the queue own wording when nothing matches the search', async () => {
    // `FloatingQueueBadge` already says this, over the same parties, in the
    // same session vocabulary. A second phrasing of one state reads as two.
    const user = userEvent.setup()
    renderPicker()
    await user.click(searchBox())
    await user.type(searchBox(), 'zzzz')
    expect(screen.getByText(/No parties match "zzzz"/)).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})

describe('PlaceFamilyPicker — nothing left to place', () => {
  it('reuses the unplaced queue own copy rather than inventing a second string', async () => {
    // The ONLY way this list can be empty: everybody is housed. There is no
    // "nothing fits" state to write copy for, because nothing is ever hidden.
    const user = userEvent.setup()
    renderPicker({ parties: [] })
    await user.click(searchBox())
    expect(screen.getByText('Everyone has a cabin.')).toBeInTheDocument()
  })
})

describe('PlaceFamilyPicker — while a write is in flight', () => {
  it('takes no second choice', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPicker({ disabled: true })
    await user.click(searchBox())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
