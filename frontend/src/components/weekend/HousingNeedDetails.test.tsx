import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HousingNeedDetails } from './HousingNeedDetails'

const DEFAULT_MEDICAL = {
  bathroom_explain: 'Grandmother cannot manage the walk at night.',
  accommodation_explain: '',
  cpap_info: '',
  special_needs_info: '',
  allergy_info: 'Tree nut',
  dietary_info: 'Vegetarian',
  physician_info: 'On file',
  additional_info: 'A birthday on Saturday',
  allergy_gate: 'yes',
  dietary_gate: 'yes',
  special_needs_gate: 'no',
  physician_gate: 'yes',
  cpap_gate: 'no',
}

// Mutable so individual tests can drive the fetch/permission/error axes
// without a fresh `vi.mock` factory per test -- the same closure-over-a-`let`
// shape `canRead` already used here.
let medical: typeof DEFAULT_MEDICAL
let medicalError: Error | null
let canRead: boolean

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: medical, isLoading: false, error: medicalError }),
}))
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => canRead }),
}))

beforeEach(() => {
  medical = { ...DEFAULT_MEDICAL }
  medicalError = null
  canRead = true
})

function party(flags: Record<string, boolean>) {
  return {
    grain: 'household',
    household_cm_id: 1000001,
    children: [],
    adults: [],
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      needs_fridge: false,
      needs_step_free: false,
      has_infant: false,
      has_child_under_two: false,
      ...flags,
    },
  } as never
}

describe('HousingNeedDetails', () => {
  it('renders one row per need, carrying the family words', () => {
    render(
      <HousingNeedDetails
        party={party({ needs_private_bathroom: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByText('Bathroom in unit')).toBeInTheDocument()
    expect(screen.getByText(/Grandmother cannot manage/)).toBeInTheDocument()
  })

  it('renders no gate pill', () => {
    render(
      <HousingNeedDetails
        party={party({ needs_private_bathroom: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    // Positive assertion first: a component returning null would also pass
    // the two negatives below, which is what made this test vacuous.
    expect(screen.getByText('Bathroom in unit')).toBeInTheDocument()
    expect(screen.queryByText('Yes')).not.toBeInTheDocument()
    expect(screen.queryByText('No')).not.toBeInTheDocument()
  })

  it('cuts allergies, dietary, physician and additional entirely', () => {
    render(
      <HousingNeedDetails
        party={party({ needs_private_bathroom: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    // Positive assertion first, for the same reason as the gate-pill test
    // above: the four negatives below would also pass a component that
    // rendered nothing at all.
    expect(screen.getByText('Bathroom in unit')).toBeInTheDocument()
    expect(screen.queryByText(/Tree nut/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Vegetarian/)).not.toBeInTheDocument()
    expect(screen.queryByText(/On file/)).not.toBeInTheDocument()
    expect(screen.queryByText(/birthday on Saturday/)).not.toBeInTheDocument()
  })

  it('keeps the need row but drops its words without bunking.manage', () => {
    canRead = false
    render(
      <HousingNeedDetails
        party={party({ needs_private_bathroom: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByText('Bathroom in unit')).toBeInTheDocument()
    expect(screen.queryByText(/Grandmother cannot manage/)).not.toBeInTheDocument()
  })

  it('renders nothing for a household that asked for nothing', () => {
    const { container } = render(
      <HousingNeedDetails party={party({})} householdCmId={1000001} year={2026} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('promotes the blocker above everything', () => {
    render(
      <HousingNeedDetails
        party={party({
          needs_accommodation: true,
          accommodation_is_mandatory: true,
          needs_private_bathroom: true,
        })}
        householdCmId={1000001}
        year={2026}
      />
    )
    const rows = screen.getAllByTestId(/^need-row-/)
    expect(rows[0]).toHaveAttribute('data-testid', 'need-row-blocker')
  })

  // `accommodation_explain` is read directly by the accommodation/blocker row
  // AND returned again by `needExplainTexts` for BOTH `fridge` and
  // `step_free` (`needGlyphs.ts` lists it as the sole `explainSources` for
  // each) -- so a household asking for accommodation, a fridge and a
  // step-free room used to see the identical paragraph under three
  // consecutive labels. Measured on the 2026 roster's 392 rostered
  // households: 10 see it repeated -- 9 twice, 1 three times -- which is all
  // 6 fridge households and 5 of the 7 step-free ones. This is the same
  // defect the owner ruled on 2026-08-23 for `bathroom_explain`/`step_free`
  // (see `needGlyphs.ts`'s own note on that ruling): one glyph, one
  // paragraph, never re-quoted under a second label.
  it('dedupes accommodation_explain across the accommodation, fridge and step-free rows', () => {
    medical.accommodation_explain = 'Needs level ground and an outlet near the bed.'
    render(
      <HousingNeedDetails
        party={party({
          needs_accommodation: true,
          needs_fridge: true,
          needs_step_free: true,
        })}
        householdCmId={1000001}
        year={2026}
      />
    )
    // All three rows still render -- the glyph and label carry the need;
    // only the duplicate TEXT is suppressed.
    expect(screen.getByTestId('need-row-accommodation')).toBeInTheDocument()
    expect(screen.getByTestId('need-row-fridge')).toBeInTheDocument()
    expect(screen.getByTestId('need-row-step_free')).toBeInTheDocument()
    expect(screen.getAllByText('Needs level ground and an outlet near the bed.')).toHaveLength(1)
  })

  // Regression (fix round 2): `dedupe()` mutates `seenTexts` as a SIDE
  // EFFECT, so it must only run for a row that is actually about to be
  // pushed. Round 1 computed `accommodationText` unconditionally, before the
  // `mandatory`/`needs_accommodation` branch decided whether any row would
  // consume it -- so a household with neither flag set still poisoned
  // `seenTexts` with `accommodation_explain`, and a later `fridge` or
  // `step_free` row (both of which read the same field through
  // `needExplainTexts`) rendered with zero text instead of one paragraph.
  //
  // This is LATENT, not live: `AccessibilityFlagSummary`'s own schema
  // comment (`api/schemas/lodging.py`) documents `needs_fridge` and
  // `needs_step_free` as "NOT GATED on `needs_accommodation`" as a CODE
  // decision, but on the current snapshot every household raising either
  // flag also raises `needs_accommodation` (6 of 6 fridge, 9 of 9 mobility;
  // kindred#2572's re-measure), so the failing combination hits zero
  // households today. It is worth fixing anyway because nothing in the data
  // model enforces that co-occurrence -- the Family Camp Information form is
  // documented as a re-submittable, per-child "drift engine"
  // (`docs/reference/family-camp-field-provenance.md` §3c), and 3 ungated
  // rows already exist (narrating through the bathroom question instead).
  // One of them gaining accommodation text turns this live.
  it('renders the fridge paragraph for a household that asks for a fridge alone', () => {
    medical.accommodation_explain = 'Needs a fridge for insulin storage.'
    render(
      <HousingNeedDetails
        party={party({ needs_fridge: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByTestId('need-row-fridge')).toBeInTheDocument()
    expect(screen.getByText('Needs a fridge for insulin storage.')).toBeInTheDocument()
  })

  it('renders the shared paragraph once, under the first of two ungated rows', () => {
    medical.accommodation_explain = 'Needs a fridge for insulin storage.'
    render(
      <HousingNeedDetails
        party={party({ needs_fridge: true, needs_step_free: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    const fridgeRow = screen.getByTestId('need-row-fridge')
    const stepFreeRow = screen.getByTestId('need-row-step_free')
    expect(screen.getAllByText('Needs a fridge for insulin storage.')).toHaveLength(1)
    expect(within(fridgeRow).queryByText('Needs a fridge for insulin storage.')).toBeInTheDocument()
    expect(
      within(stepFreeRow).queryByText('Needs a fridge for insulin storage.')
    ).not.toBeInTheDocument()
  })

  it('renders an inline error and no spinner when the medical fetch fails', () => {
    medicalError = new Error('Could not load medical detail.')
    render(
      <HousingNeedDetails
        party={party({ needs_private_bathroom: true })}
        householdCmId={1000001}
        year={2026}
      />
    )
    // No spinner: the row paints immediately off the roster boolean alone,
    // and the label is its own placeholder while the narrative loads (see
    // `needExplainTexts`'s own note). The error surfaces beside that row
    // rather than blocking it.
    expect(screen.getByText('Bathroom in unit')).toBeInTheDocument()
    expect(screen.getByText('Could not load medical detail.')).toBeInTheDocument()
  })
})
