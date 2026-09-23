/**
 * The member-unit picker shared by the alias editor and the unresolved queue.
 *
 * It replaced a flat wall of ~100 checkboxes. What it must keep from that wall
 * is everything the old fieldset guarded: only bookable units are offered, a
 * member already on the alias is never hidden, and a prior-season member is
 * named distinctly from its same-named current-season twin.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingAreaRecord, LodgingUnitRecord } from '../../../types/lodging'
import { AliasUnitPicker } from './AliasUnitPicker'

function area(id: string, name: string, sortOrder: number): LodgingAreaRecord {
  return { id, name, code: id, map_x: 0, map_y: 0, sort_order: sortOrder }
}

const NORTH = area('ar_n', 'North Field', 1)
const RIVER = area('ar_r', 'River Bend', 2)

function unit(
  id: string,
  name: string,
  over: Partial<LodgingUnitRecord> & {
    areaRecord?: LodgingAreaRecord
    parent?: LodgingUnitRecord
  } = {}
): LodgingUnitRecord {
  const { areaRecord = NORTH, parent, ...rest } = over
  return {
    id,
    name,
    code: id,
    area: areaRecord.id,
    parent_unit: parent?.id ?? '',
    is_active: true,
    is_container: false,
    expand: { area: areaRecord, ...(parent ? { parent_unit: parent } : {}) },
    ...rest,
  } as LodgingUnitRecord
}

const LODGE = unit('lodge', 'Pine Lodge', { is_container: true })
const UNITS = [
  unit('n1', 'Cabin 1'),
  unit('n2', 'Cabin 2'),
  LODGE,
  unit('l1', 'Upstairs', { parent: LODGE }),
  unit('l2', 'Downstairs', { parent: LODGE }),
  unit('r1', 'Willow', { areaRecord: RIVER }),
  unit('old', 'Old Hall', { areaRecord: RIVER, is_active: false }),
]

function Harness({
  units = UNITS,
  initial = [],
  outOfSeasonIds,
  onChange,
}: {
  units?: LodgingUnitRecord[]
  initial?: string[]
  outOfSeasonIds?: ReadonlySet<string>
  onChange?: (ids: string[]) => void
}) {
  const [selected, setSelected] = useState(initial)
  return (
    <AliasUnitPicker
      units={units}
      selected={selected}
      outOfSeasonIds={outOfSeasonIds}
      onChange={(ids) => {
        setSelected(ids)
        onChange?.(ids)
      }}
    />
  )
}

const search = () => screen.getByRole('searchbox', { name: 'Search units' })

describe('AliasUnitPicker — the list', () => {
  it('stays closed until the search field is used', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.queryByRole('checkbox', { name: 'Cabin 1' })).not.toBeInTheDocument()
    await user.click(search())
    expect(screen.getByRole('checkbox', { name: 'Cabin 1' })).toBeInTheDocument()
  })

  it('groups units under their area, and rooms under their building', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(search())

    const north = screen.getByRole('group', { name: 'North Field' })
    expect(within(north).getByRole('checkbox', { name: 'Cabin 1' })).toBeInTheDocument()
    expect(within(north).getByText('Pine Lodge')).toBeInTheDocument()
    expect(within(north).getByRole('checkbox', { name: 'Upstairs' })).toBeInTheDocument()
    const river = screen.getByRole('group', { name: 'River Bend' })
    expect(within(river).getByRole('checkbox', { name: 'Willow' })).toBeInTheDocument()
  })

  it('narrows by room, building or area name', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(search(), 'pine')
    expect(screen.getByRole('checkbox', { name: 'Upstairs' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Cabin 1' })).not.toBeInTheDocument()

    await user.clear(search())
    await user.type(search(), 'river')
    expect(screen.getByRole('checkbox', { name: 'Willow' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Cabin 2' })).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(search(), 'zzz')
    expect(screen.getByText(/No bookable unit matches/)).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(search())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('checkbox', { name: 'Cabin 1' })).not.toBeInTheDocument()
  })
})

describe('AliasUnitPicker — picking', () => {
  it('adds a ticked unit as a removable chip', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)

    await user.click(search())
    await user.click(screen.getByRole('checkbox', { name: 'Cabin 1' }))
    expect(onChange).toHaveBeenLastCalledWith(['n1'])

    await user.click(screen.getByRole('button', { name: 'Remove Cabin 1' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  // A merge is usually of same-named rooms ("Tioga 1".."Tioga 4"): one search
  // should serve every tick, not be retyped before each one.
  it('keeps the search and its results after a tick, so a merge takes one search', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)

    await user.type(search(), 'cabin')
    await user.click(screen.getByRole('checkbox', { name: 'Cabin 1' }))

    expect(search()).toHaveValue('cabin')
    expect(search()).toHaveFocus()
    expect(screen.queryByRole('checkbox', { name: 'Willow' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Cabin 2' }))
    expect(onChange).toHaveBeenLastCalledWith(['n1', 'n2'])
  })

  it('removes the last pick on Backspace in an empty search', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial={['n1', 'n2']} onChange={onChange} />)

    await user.click(search())
    await user.keyboard('{Backspace}')
    expect(onChange).toHaveBeenLastCalledWith(['n1'])
  })

  it('names a single room and a merge differently', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['n1']} />)
    expect(screen.getByText('Single unit')).toBeInTheDocument()

    await user.click(search())
    await user.click(screen.getByRole('checkbox', { name: 'Cabin 2' }))
    expect(screen.getByText('Merge of 2 units')).toBeInTheDocument()
  })
})

describe('AliasUnitPicker — which units are offered', () => {
  // A container is not bookable and a retired unit was taken out on purpose;
  // an alias pointing at either resolves history onto a place that cannot be
  // booked (see aliasMembers.ts).
  it('offers only active, non-container units', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(search())

    expect(screen.queryByRole('checkbox', { name: 'Pine Lodge' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Old Hall' })).not.toBeInTheDocument()
  })

  it('still offers a retired unit the alias already names, so saving cannot drop it', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['old']} />)

    expect(screen.getByRole('button', { name: 'Remove Old Hall' })).toBeInTheDocument()
    await user.click(search())
    expect(screen.getByRole('checkbox', { name: 'Old Hall' })).toBeChecked()
  })

  it('marks a prior-season member so it cannot be mistaken for its current twin', async () => {
    const user = userEvent.setup()
    const prior = unit('n1_prev', 'Cabin 1')
    render(
      <Harness
        units={[...UNITS, prior]}
        initial={['n1_prev']}
        outOfSeasonIds={new Set(['n1_prev'])}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Remove Cabin 1 (different season)' })
    ).toBeInTheDocument()
    await user.click(search())
    expect(screen.getByRole('checkbox', { name: 'Cabin 1 (different season)' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Cabin 1' })).not.toBeChecked()
  })
})
