/**
 * Accessibility flags are derived booleans, and that is now ALL this
 * component is.
 *
 * It used to carry the medical narrative too, behind a click-to-reveal gated
 * on `bunking.manage` (kindred#2312 retargeted the gate from the now-removed
 * `lodging.phi`). kindred#1889 split that out: the narrative lives in
 * `HousingNeedDetails`, which `FamilyDetailsPanel` renders and
 * `HouseholdRosterRow` does not. The reason is grain — the roster row is a
 * `<tr>` and 62 of them are on screen at once, while the panel shows one
 * household at a time, exactly the split summer makes between a camper card
 * and `CamperDetailsPanel`.
 *
 * What this file pins is the ABSENCE: no permission check, no fetch, no
 * state. A chips list that reaches for the narrative is what was wrong.
 *
 * ⚠️ AND IT PINS ONE MORE ABSENCE NOW: no second list of needs. The rows and
 * the roster's filter chips are DERIVED from `NEED_GLYPHS` (kindred#2072's
 * "one place a need is graded"), so the `needGlyphs` mock below appends a
 * synthetic fifth need that this file never names anywhere else. A component
 * that hardcodes its four branches back cannot render it, which is the whole
 * point of the mock.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AccessibilityFlags } from '../../types/lodging'
import { AccessibilityFlagList, NEED_FILTER_OPTIONS } from './AccessibilityFlagList'
import { NEED_GLYPHS } from './needGlyphs'

/**
 * A need that exists only inside this file's module mock.
 *
 * Its `flag` is `accommodation_is_mandatory` because every other key on
 * `AccessibilityFlags` is already a real need's flag, and a synthetic key
 * would not typecheck. Setting it alone renders no accommodation row — that
 * row is gated on `needs_accommodation` — so the probe is unambiguous.
 */
const { SYNTHETIC_KEY, SYNTHETIC_LABEL, SYNTHETIC_FLAG } = vi.hoisted(() => ({
  SYNTHETIC_KEY: 'synthetic_probe',
  SYNTHETIC_LABEL: 'Synthetic probe need',
  SYNTHETIC_FLAG: 'accommodation_is_mandatory',
}))

vi.mock('./needGlyphs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./needGlyphs')>()
  // Imported INSIDE the factory: `vi.mock` is hoisted above this file's own
  // imports, so a top-level lucide binding would not be initialized yet.
  const { CircleHelp } = await import('lucide-react')
  return {
    ...actual,
    NEED_GLYPHS: [
      ...actual.NEED_GLYPHS,
      {
        key: SYNTHETIC_KEY,
        flag: SYNTHETIC_FLAG,
        label: SYNTHETIC_LABEL,
        Icon: CircleHelp,
        hueClassName: 'text-sky-500 dark:text-sky-400',
        someIs: 'unmet',
        coverage: () => 'unknown',
      },
    ] as unknown as typeof actual.NEED_GLYPHS,
  }
})

const useHouseholdMedical = vi.fn(() => ({ data: undefined, isLoading: false, error: null }))

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: (...args: unknown[]) => useHouseholdMedical(...(args as [])),
}))

function flags(overrides: Partial<AccessibilityFlags> = {}): AccessibilityFlags {
  return {
    needs_private_bathroom: false,
    needs_power: false,
    needs_fridge: false,
    needs_step_free: false,
    needs_accommodation: false,
    accommodation_is_mandatory: false,
    has_infant: false,
    has_child_under_two: false,
    ...overrides,
  }
}

describe('derived flags', () => {
  it('renders the bathroom need', () => {
    // "Bathroom in unit", not "Private bathroom". The label comes from
    // `NEED_GLYPHS` now, and kindred#2501 moved the RULE to presence — a
    // household reported here has no bathroom in the unit at all, shared or
    // otherwise, so the ask and the verdict name the same axis.
    render(<AccessibilityFlagList flags={flags({ needs_private_bathroom: true })} />)
    expect(screen.getByText('Bathroom in unit')).toBeInTheDocument()
  })

  it('renders the power need (CPAP)', () => {
    render(<AccessibilityFlagList flags={flags({ needs_power: true })} />)
    expect(screen.getByText('Power')).toBeInTheDocument()
  })

  it('renders the fridge need (kindred#2224)', () => {
    // Six 2026 households ask for a fridge and no roster surface said so —
    // one of them sits on a card whose `fridge_coverage` is `none`, drawing a
    // red glyph on the board while this panel did not mention a fridge at all.
    render(<AccessibilityFlagList flags={flags({ needs_fridge: true })} />)
    expect(screen.getByText('Fridge')).toBeInTheDocument()
  })

  it('renders the step-free need (kindred#2438)', () => {
    render(<AccessibilityFlagList flags={flags({ needs_step_free: true })} />)
    expect(screen.getByText('Step-free')).toBeInTheDocument()
  })

  it('treats power and bathroom as INDEPENDENT needs', () => {
    // The CPAP / adult-infant source fields are multi-option, not boolean, and
    // one option carries both needs. A household can need power without a
    // bathroom in the unit and vice versa; neither implies the other.
    render(
      <AccessibilityFlagList flags={flags({ needs_power: true, needs_private_bathroom: false })} />
    )
    expect(screen.getByText('Power')).toBeInTheDocument()
    expect(screen.queryByText('Bathroom in unit')).not.toBeInTheDocument()
  })

  it('renders the infant flag', () => {
    render(<AccessibilityFlagList flags={flags({ has_infant: true })} />)
    expect(screen.getByText('Infant in party')).toBeInTheDocument()
  })

  it('renders the computed child-under-two flag (staff ruling, 2026-08-21)', () => {
    // COMPUTED server-side from the children's birthdates, unlike every row
    // above — `has_infant` is form-declared and dead on family weekends
    // (0 across all 3,923 production family_camp_registrations rows).
    render(<AccessibilityFlagList flags={flags({ has_child_under_two: true })} />)
    expect(screen.getByText('Child under 2 in party')).toBeInTheDocument()
  })

  it('treats the infant and under-two rows as independent facts', () => {
    // Different provenance: one is a form answer, one is computed. Neither
    // implies the other, and each renders without the other.
    render(
      <AccessibilityFlagList flags={flags({ has_child_under_two: true, has_infant: false })} />
    )
    expect(screen.getByText('Child under 2 in party')).toBeInTheDocument()
    expect(screen.queryByText('Infant in party')).not.toBeInTheDocument()
  })

  it('distinguishes a mandatory accommodation from a preference', () => {
    const { rerender } = render(
      <AccessibilityFlagList
        flags={flags({ needs_accommodation: true, accommodation_is_mandatory: true })}
      />
    )
    expect(screen.getByText('Accommodation required')).toBeInTheDocument()

    rerender(
      <AccessibilityFlagList
        flags={flags({ needs_accommodation: true, accommodation_is_mandatory: false })}
      />
    )
    expect(screen.getByText('Accommodation requested')).toBeInTheDocument()
  })

  it('renders nothing when no flag is set', () => {
    const { container } = render(<AccessibilityFlagList flags={flags()} />)
    expect(container.textContent).toBe('')
  })
})

describe('one place a need is named — derived from NEED_GLYPHS', () => {
  it('renders a row for EVERY graded need, not the two it used to hardcode', () => {
    const everyGradedFlag = Object.fromEntries(
      NEED_GLYPHS.map((glyph) => [glyph.flag, true])
    ) as Partial<AccessibilityFlags>
    render(<AccessibilityFlagList flags={flags(everyGradedFlag)} />)
    for (const glyph of NEED_GLYPHS) {
      expect(screen.getByText(glyph.label)).toBeInTheDocument()
    }
  })

  it('renders a row for a need added to NEED_GLYPHS with no second edit here', () => {
    // The mock above appends a fifth spec. A four-branch `if` chain cannot
    // render it — this is the test that fails if somebody re-hardcodes.
    render(<AccessibilityFlagList flags={flags({ accommodation_is_mandatory: true })} />)
    expect(screen.getByText(SYNTHETIC_LABEL)).toBeInTheDocument()
    // ...and NOT the accommodation row, which is gated on a different flag.
    expect(screen.queryByText(/^Accommodation/)).not.toBeInTheDocument()
  })

  it('offers exactly one filter option per graded need, in the glyph order, plus the two ungraded extras', () => {
    // `accommodation` names no amenity (no cabin field answers it) and
    // `infant` is the Adult-Infant form answer, so neither is a graded need
    // and neither can be derived from NEED_GLYPHS. They are the ONLY two
    // ungraded FILTER keys — the component also renders a third ungraded
    // fact, `has_child_under_two`, whose filter entry is deliberately
    // deferred to kindred#2480 (it must key on the computed flag there).
    expect(NEED_FILTER_OPTIONS.map((option) => option.key)).toEqual([
      'accommodation',
      ...NEED_GLYPHS.map((glyph) => glyph.key),
      'infant',
    ])
  })

  it('takes each graded option label and icon from the glyph itself, never a second copy', () => {
    for (const glyph of NEED_GLYPHS) {
      const option = NEED_FILTER_OPTIONS.find((candidate) => candidate.key === glyph.key)
      expect(option?.label).toBe(glyph.label)
      expect(option?.icon).toBe(glyph.Icon)
    }
  })

  it('matches each graded option on the glyph OWN flag', () => {
    for (const glyph of NEED_GLYPHS) {
      const option = NEED_FILTER_OPTIONS.find((candidate) => candidate.key === glyph.key)
      expect(option?.matches({ [glyph.flag]: true })).toBe(true)
      expect(option?.matches({})).toBe(false)
    }
  })
})

describe('the medical narrative is not this component', () => {
  it('never fetches the narrative', () => {
    // The strongest form of the split. This component is rendered 62 times on
    // a roster page; if it can reach the medical hook at all, a later change can
    // make 62 gated requests by accident.
    useHouseholdMedical.mockClear()
    render(<AccessibilityFlagList flags={flags({ needs_power: true })} />)
    expect(useHouseholdMedical).not.toHaveBeenCalled()
  })

  it('renders no medical affordance', () => {
    render(<AccessibilityFlagList flags={flags({ needs_power: true })} />)
    expect(screen.queryByRole('button', { name: /medical/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/medical detail/i)).not.toBeInTheDocument()
  })
})
