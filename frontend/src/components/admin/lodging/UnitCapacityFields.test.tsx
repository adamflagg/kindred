/**
 * The read-only whole-house figure this file's header now promises: shown
 * beside the delta field for a container, never written anywhere (kindred#2079,
 * owner ruling: offer, never write — see derivedCapacity.ts for the
 * arithmetic this renders).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRecord } from '../../../types/lodging'
import { UnitCapacityFields, type UnitCapacityFieldsProps } from './UnitCapacityFields'

function unit(over: Partial<LodgingUnitRecord> & { id: string }): LodgingUnitRecord {
  return {
    area: 'area_1',
    name: over.id,
    code: over.id,
    parent_unit: '',
    map_x: 0,
    map_y: 0,
    sleeps: 0,
    beds: null,
    bathroom: 'none',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    has_tub: false,
    has_crib: false,
    has_changing_table: false,
    has_shared_fridge: false,
    is_weatherized: false,
    has_plumbing: false,
    has_space_heater: false,
    has_lights: false,
    has_heat: false,
    has_pack_play_space: false,
    has_kitchen: false,
    has_living_room: false,
    inventory_class: 'family_pool',
    shareability: '',
    is_confirmed: false,
    is_active: true,
    is_container: false,
    default_combined: false,
    notes: '',
    ...over,
  }
}

const HOUSE = unit({ id: 'house', is_container: true })
const ROOM_1 = unit({ id: 'room-1', parent_unit: 'house', sleeps: 4 })
const ROOM_2 = unit({ id: 'room-2', parent_unit: 'house', sleeps: 5 })

function renderFields(over: Partial<UnitCapacityFieldsProps> = {}) {
  const onChange = vi.fn()
  render(
    <UnitCapacityFields
      value={{ sleeps: '', beds: [] }}
      onChange={onChange}
      isConfirmed={false}
      isContainer={false}
      unit={undefined}
      units={[]}
      {...over}
    />
  )
  return { onChange }
}

describe('UnitCapacityFields — derived whole-house figure', () => {
  it('shows the derived total for a container whose rooms are all measured', () => {
    renderFields({ isContainer: true, unit: HOUSE, units: [HOUSE, ROOM_1, ROOM_2] })

    expect(screen.getByText(/9/)).toBeInTheDocument()
  })

  it('adds the typed delta rather than replacing the room sum with it', () => {
    renderFields({
      value: { sleeps: '1', beds: [] },
      isContainer: true,
      unit: HOUSE,
      units: [HOUSE, ROOM_1, ROOM_2],
    })

    expect(screen.getByText(/10/)).toBeInTheDocument()
  })

  it('reacts live as the delta field is edited', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <UnitCapacityFields
        value={{ sleeps: '', beds: [] }}
        onChange={onChange}
        isConfirmed={false}
        isContainer={true}
        unit={HOUSE}
        units={[HOUSE, ROOM_1, ROOM_2]}
      />
    )
    expect(screen.getByText(/9/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Sleeps'), '2')
    // The component itself is controlled — re-render with the value its own
    // onChange would have produced, same as the real form does.
    rerender(
      <UnitCapacityFields
        value={{ sleeps: '2', beds: [] }}
        onChange={onChange}
        isConfirmed={false}
        isContainer={true}
        unit={HOUSE}
        units={[HOUSE, ROOM_1, ROOM_2]}
      />
    )
    expect(screen.getByText(/11/)).toBeInTheDocument()
  })

  it('shows nothing when a leaf under the container is unmeasured', () => {
    renderFields({
      isContainer: true,
      unit: HOUSE,
      units: [HOUSE, ROOM_1, unit({ id: 'room-2', parent_unit: 'house', sleeps: 0 })],
    })

    expect(screen.queryByText(/9/)).not.toBeInTheDocument()
  })

  it('shows nothing for a childless container — nothing but its own delta to report', () => {
    renderFields({
      value: { sleeps: '1', beds: [] },
      isContainer: true,
      unit: HOUSE,
      units: [HOUSE],
    })

    // The delta field itself already shows "1" — a second "derived" copy of
    // the same number would be noise, not information.
    expect(screen.queryByText(/derived/i)).not.toBeInTheDocument()
  })

  it('shows nothing for a leaf (non-container) unit', () => {
    renderFields({
      isContainer: false,
      unit: ROOM_1,
      units: [HOUSE, ROOM_1, ROOM_2],
    })

    expect(screen.queryByText(/derived/i)).not.toBeInTheDocument()
  })

  it('shows nothing on create, before the unit has an id to look up children by', () => {
    renderFields({ isContainer: true, unit: undefined, units: [HOUSE, ROOM_1, ROOM_2] })

    expect(screen.queryByText(/derived/i)).not.toBeInTheDocument()
  })

  it('renders as plain text, not as a control — no button offers to write it', () => {
    renderFields({ isContainer: true, unit: HOUSE, units: [HOUSE, ROOM_1, ROOM_2] })

    expect(screen.getByText(/9/).closest('button')).toBeNull()
    expect(
      screen.queryByRole('button', { name: /derived|use derived|whole house/i })
    ).not.toBeInTheDocument()
  })

  it('never calls onChange merely by rendering the derived figure', () => {
    const { onChange } = renderFields({
      isContainer: true,
      unit: HOUSE,
      units: [HOUSE, ROOM_1, ROOM_2],
    })

    expect(onChange).not.toHaveBeenCalled()
  })
})
