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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function press(canvas: HTMLElement, x: number, y: number, pointerId = 1) {
  fireEvent.pointerDown(canvas, { pointerId, button: 0, buttons: 1, clientX: x, clientY: y })
}
/**
 * A move made WITH THE BUTTON STILL DOWN, which is the only kind a real drag
 * produces. `buttons` is not decoration here: a move that arrives with no
 * button held means the release happened somewhere this canvas never saw, and
 * the field ends the gesture on it — see "released away from the canvas".
 */
function move(canvas: HTMLElement, x: number, y: number, pointerId = 1) {
  fireEvent.pointerMove(canvas, { pointerId, buttons: 1, clientX: x, clientY: y })
}
/** The pointer merely passing over the canvas, nothing held down. */
function hover(canvas: HTMLElement, x: number, y: number, pointerId = 1) {
  fireEvent.pointerMove(canvas, { pointerId, buttons: 0, clientX: x, clientY: y })
}
function lift(canvas: HTMLElement, x: number, y: number, pointerId = 1) {
  fireEvent.pointerUp(canvas, { pointerId, button: 0, buttons: 0, clientX: x, clientY: y })
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

  it('leaves native touch scrolling alone while the gate is shut', () => {
    // `touch-none` is what stops a finger from scrolling the page. It belongs
    // to the drag, so it may only exist while the drag does — otherwise the
    // gate would still be taxing every staffer who scrolls past this canvas.
    render(<UnitMapPositionField unit={UNIT} />)

    expect(screen.getByTestId('unit-map-canvas').className).not.toContain('touch-none')
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

  it('lets the last drop win when two writes are in flight at once', async () => {
    // Two drops inside one round-trip. Whichever request answers first, the
    // pin has to end up where the staffer last put it — an older response
    // landing late must not drag it back, and must not blank a drop that has
    // not been answered yet.
    const answer: Array<() => void> = []
    updateLodgingUnit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          answer.push(() => {
            resolve()
          })
        })
    )
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()

    press(canvas, 400, 240)
    lift(canvas, 400, 240)
    press(canvas, 600, 480)
    lift(canvas, 600, 480)
    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      answer[1]?.()
    })
    expect(pin()?.style.left).toBe('60%')

    await act(async () => {
      answer[0]?.()
    })
    expect(pin()?.style.left).toBe('60%')
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

describe('UnitMapPositionField — a gesture that goes wrong commits nothing', () => {
  it('ends the gesture when the pointer is released away from the canvas', async () => {
    // A drag out of the canvas and a release out there: the pointerup lands on
    // whatever is under the cursor, never here. A real browser hands the
    // gesture back through pointer capture, but if it does not, the field must
    // NOT stay armed — a still-live drag turns a later mouse-over into a pin
    // that follows the cursor and the next click into a silent write.
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()
    const stored = pin()?.style.left

    press(canvas, 300, 160)
    move(canvas, 500, 300)
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 4000, clientY: 4000 })
    hover(canvas, 900, 700)

    expect(pin()?.style.left).toBe(stored)
    lift(canvas, 900, 700)
    expect(updateLodgingUnit).not.toHaveBeenCalled()
  })

  it('captures the pointer, so a release outside is still delivered here', async () => {
    // The browser-side half of the test above. jsdom implements no pointer
    // capture at all, so the canvas has to be given one to observe: in a real
    // browser this is what makes the drag survive leaving the canvas, and the
    // `buttons` check is only the fallback for when it is unavailable.
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()
    const setPointerCapture = vi.fn()
    Object.assign(canvas, { setPointerCapture })

    press(canvas, 300, 160, 9)

    expect(setPointerCapture).toHaveBeenCalledWith(9)
  })

  it('ignores a right-click, which places nothing', async () => {
    // The context menu opens and the pointerup arrives all the same, so an
    // unguarded handler would write wherever the staffer right-clicked.
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()
    const stored = pin()?.style.left

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 2,
      buttons: 2,
      clientX: 900,
      clientY: 700,
    })
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 2, buttons: 0, clientX: 900, clientY: 700 })

    expect(pin()?.style.left).toBe(stored)
    expect(updateLodgingUnit).not.toHaveBeenCalled()
  })

  it('ignores a second finger landing during a drag', async () => {
    // Two fingers on a touchscreen are one pinch, not two placements. Only the
    // pointer that started the drag may move it or end it.
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()

    press(canvas, 300, 160)
    press(canvas, 900, 700, 2)
    move(canvas, 950, 750, 2)
    lift(canvas, 950, 750, 2)

    expect(updateLodgingUnit).not.toHaveBeenCalled()

    move(canvas, 400, 240)
    lift(canvas, 400, 240)

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledTimes(1)
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, Partial<LodgingUnitInput>]
    expect(payload).toEqual({ map_x: 0.4, map_y: 0.3 })
  })

  it('commits nothing when the browser takes the gesture away', async () => {
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()
    const stored = pin()?.style.left

    press(canvas, 300, 160)
    move(canvas, 900, 700)
    fireEvent.pointerCancel(canvas, { pointerId: 1 })

    expect(pin()?.style.left).toBe(stored)
    lift(canvas, 900, 700)
    expect(updateLodgingUnit).not.toHaveBeenCalled()
  })

  it('abandons a drag in flight when the gate is switched back off', async () => {
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()
    const stored = pin()?.style.left

    press(canvas, 300, 160)
    move(canvas, 900, 700)
    fireEvent.click(screen.getByLabelText(/edit position/i))

    expect(screen.getByLabelText(/edit position/i)).not.toBeChecked()
    expect(pin()?.style.left).toBe(stored)
    expect(updateLodgingUnit).not.toHaveBeenCalled()
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

  it('never writes the (0,0) that MEANS unplaced, even off the top-left corner', async () => {
    // The trap arriving through the fix, by its other door. A drag off the
    // top-left clamps to exactly the origin — and the origin is the sentinel
    // `hasCoordinates` reads as "no position at all", so storing it would
    // UNPLACE the unit through the gesture meant to place it. Every other edge
    // is a real coordinate and keeps clamping to the edge.
    render(<UnitMapPositionField unit={UNIT} />)
    await enableEditing()
    const canvas = canvasOf()

    press(canvas, 300, 160)
    lift(canvas, -80, -60)

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledTimes(1)
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, Partial<LodgingUnitInput>]
    expect(payload).not.toEqual({ map_x: 0, map_y: 0 })
    expect(payload.map_x).toBeGreaterThan(0)
    expect(payload.map_y).toBeGreaterThan(0)
    // ...and still the top-left corner to any eye: a ten-thousandth of the
    // map is a third of a pixel at full render.
    expect(payload.map_x).toBeLessThan(0.001)
    expect(payload.map_y).toBeLessThan(0.001)
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
