/**
 * The map-pin editor, and above all the GATE in front of it.
 *
 * kindred#2013 was ruled "option B, behind an explicit edit mode": a drag
 * commits the moment the pointer lifts — the same save-on-interaction shape
 * `LodgingAreasDrawer`'s centroid inputs use — but nothing is draggable until
 * the staffer says so. The first test below is the one the whole ruling exists
 * to satisfy and is not an afterthought: with edit mode off, a pointer gesture
 * over this canvas must be incapable of moving a pin or writing a coordinate.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateLodgingUnit = vi.fn()

vi.mock('../../../services/lodgingCrud', () => ({
  updateLodgingUnit: (...args: unknown[]) => updateLodgingUnit(...args),
}))

const toastError = vi.fn()

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}))

import type { LodgingUnitInput, LodgingUnitRecord } from '../../../types/lodging'
import { UnitMapPositionField } from './UnitMapPositionField'

const UNIT: LodgingUnitRecord = {
  id: 'u1',
  area: 'area_1',
  name: 'Cabin A',
  code: 'cabin-a',
  parent_unit: '',
  map_x: 0.3,
  map_y: 0.2,
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
  has_kitchenette: false,
  has_crib: false,
  has_changing_table: false,
  has_shared_fridge: false,
  inventory_class: 'family_pool',
  shareability: '',
  is_confirmed: false,
  is_active: true,
  is_container: false,
  default_combined: false,
  notes: '',
}

/** jsdom performs no layout, so the canvas has to be told how big it is. */
const RECT_WIDTH = 1000
const RECT_HEIGHT = 800

function canvasOf(): HTMLElement {
  const canvas = screen.getByTestId('unit-map-canvas')
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: RECT_WIDTH,
    height: RECT_HEIGHT,
    right: RECT_WIDTH,
    bottom: RECT_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  return canvas
}

function press(canvas: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(canvas, { pointerId: 1, clientX: x, clientY: y })
}
function move(canvas: HTMLElement, x: number, y: number) {
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: x, clientY: y })
}
function lift(canvas: HTMLElement, x: number, y: number) {
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: x, clientY: y })
}

const pin = () => screen.queryByTestId('unit-map-pin')

async function enableEditing() {
  const user = userEvent.setup()
  await user.click(screen.getByLabelText(/edit position/i))
}

beforeEach(() => {
  updateLodgingUnit.mockReset()
  updateLodgingUnit.mockResolvedValue({ ...UNIT })
  toastError.mockReset()
})

describe('UnitMapPositionField — the gate', () => {
  it('starts with edit mode off', () => {
    render(<UnitMapPositionField unit={UNIT} />)

    expect(screen.getByLabelText(/edit position/i)).not.toBeChecked()
  })

  it('cannot move a pin or write a coordinate while edit mode is off', () => {
    // THE test this whole ruling exists for. A pan, a scroll or a touch-drag
    // across this canvas is an accident, not an edit, and with the gate shut
    // there must be no handler for it to reach at all.
    render(<UnitMapPositionField unit={UNIT} />)
    const canvas = canvasOf()
    const before = pin()?.style.left

    press(canvas, 900, 700)
    move(canvas, 100, 100)
    lift(canvas, 100, 100)

    expect(pin()?.style.left).toBe(before)
    expect(updateLodgingUnit).not.toHaveBeenCalled()
  })

  it('offers the gate as a real checkbox, reachable by keyboard', () => {
    // The map surface is 99% pointer-driven and the empty-rooms toggle is its
    // last keyboard-reachable control (see LodgingMap's accessibility note).
    // A pointer-only gate here would repeat the mistake that note warns about.
    render(<UnitMapPositionField unit={UNIT} />)
    const toggle = screen.getByLabelText(/edit position/i)

    expect(toggle).toHaveProperty('tagName', 'INPUT')
    expect(toggle).toHaveAttribute('type', 'checkbox')
  })

  it('can be switched on from the keyboard alone', async () => {
    const user = userEvent.setup()
    render(<UnitMapPositionField unit={UNIT} />)

    screen.getByLabelText(/edit position/i).focus()
    await user.keyboard(' ')

    expect(screen.getByLabelText(/edit position/i)).toBeChecked()
  })

  it('is visibly distinct while it is on, so nobody leaves it enabled unawares', async () => {
    render(<UnitMapPositionField unit={UNIT} />)
    expect(screen.queryByText(/editing/i)).not.toBeInTheDocument()

    await enableEditing()

    expect(screen.getByText(/editing/i)).toBeInTheDocument()
    expect(screen.getByTestId('unit-map-canvas').className).toContain('ring-primary')
  })
})

describe('UnitMapPositionField — a drag commits on pointer-up', () => {
  it('writes the dropped coordinate once the pointer lifts', async () => {
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()

    press(canvas, 300, 160)
    move(canvas, 400, 240)
    lift(canvas, 400, 240)

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledTimes(1)
    })
    const [id, payload] = updateLodgingUnit.mock.calls[0] as [string, Partial<LodgingUnitInput>]
    expect(id).toBe('u1')
    expect(payload).toEqual({ map_x: 0.4, map_y: 0.3 })
  })

  it('writes nothing while the pointer is still down, but moves the pin', () => {
    render(<UnitMapPositionField unit={UNIT} />)
    const toggle = screen.getByLabelText(/edit position/i)
    fireEvent.click(toggle)
    const canvas = canvasOf()
    const before = pin()?.style.left

    // Grabbing AWAY from the stored point on purpose: pressing on it would be
    // caught by the unchanged-coordinate skip below, and this test would pass
    // just as happily against an implementation that wrote on pointer-DOWN.
    press(canvas, 200, 400)
    move(canvas, 400, 240)

    expect(pin()?.style.left).not.toBe(before)
    expect(updateLodgingUnit).not.toHaveBeenCalled()
  })

  it('rounds to the precision the canvas can actually express', async () => {
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()

    press(canvas, 123.456, 321.987)
    lift(canvas, 123.456, 321.987)

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledTimes(1)
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, Partial<LodgingUnitInput>]
    expect(payload).toEqual({ map_x: 0.1235, map_y: 0.4025 })
  })

  it('does not re-write a coordinate that did not change', () => {
    // Mirrors saveCentroid's `if (value === area[axis]) return`.
    render(<UnitMapPositionField unit={UNIT} />)
    fireEvent.click(screen.getByLabelText(/edit position/i))
    const canvas = canvasOf()

    press(canvas, 300, 160)
    lift(canvas, 300, 160)

    expect(updateLodgingUnit).not.toHaveBeenCalled()
  })

  it('clamps a drop dragged off the edge back onto the map', async () => {
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()

    press(canvas, 300, 160)
    lift(canvas, -400, 5000)

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledTimes(1)
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, Partial<LodgingUnitInput>]
    expect(payload).toEqual({ map_x: 0, map_y: 1 })
  })

  it('puts the stored position back when the write is refused', async () => {
    updateLodgingUnit.mockRejectedValue(new Error('Network request failed'))
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()
    const before = pin()?.style.left

    press(canvas, 900, 600)
    lift(canvas, 900, 600)

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(pin()?.style.left).toBe(before)
  })
})

describe('UnitMapPositionField — an unset pair is not the origin', () => {
  const UNSET: LodgingUnitRecord = { ...UNIT, map_x: 0, map_y: 0 }

  it('draws no pin for a unit that was never placed', () => {
    render(<UnitMapPositionField unit={UNSET} />)

    expect(pin()).not.toBeInTheDocument()
    expect(screen.getByText(/no position yet/i)).toBeInTheDocument()
  })

  it('writes nothing for an unplaced unit until someone actually places it', () => {
    // The (0,0) trap, arriving through the fix: a unit with no position must
    // not be quietly written to the top-left corner just because the editor
    // was opened on it.
    render(<UnitMapPositionField unit={UNSET} />)

    expect(updateLodgingUnit).not.toHaveBeenCalled()
  })

  it('places an unplaced unit where the staffer presses', async () => {
    render(<UnitMapPositionField unit={UNSET} />)
    await enableEditing()
    const canvas = canvasOf()

    press(canvas, 500, 400)
    lift(canvas, 500, 400)

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledTimes(1)
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, Partial<LodgingUnitInput>]
    expect(payload).toEqual({ map_x: 0.5, map_y: 0.5 })
    expect(pin()).toBeInTheDocument()
  })
})

describe('UnitMapPositionField — the registry has to hear about it', () => {
  it('tells its host a position landed, so the cached registry can be refreshed', async () => {
    const onPositionSaved = vi.fn()
    render(<UnitMapPositionField unit={UNIT} onPositionSaved={onPositionSaved} />)
    await enableEditing()
    const canvas = canvasOf()

    press(canvas, 400, 240)
    lift(canvas, 400, 240)

    await waitFor(() => {
      expect(onPositionSaved).toHaveBeenCalledTimes(1)
    })
  })
})
