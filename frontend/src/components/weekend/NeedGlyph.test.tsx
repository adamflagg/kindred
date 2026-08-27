/**
 * The need-glyph tooltip's explain text — the family's own words, for staff
 * who may read them.
 *
 * The four glyphs are derived flags: the Go sync sets `needs_power` because a
 * family wrote something in `cpap_info`, `needs_private_bathroom` because they
 * wrote `bathroom_explain`, and so on. The flag reaches every card in the
 * roster payload; the TEXT deliberately does not. `HouseholdMedicalResponse`
 * is served by ONE endpoint gated on `bunking.manage`, and
 * `test_lodging_medical_narrative_containment.py` pins that no explain field
 * ever rides the roster. This file is the client half of that bargain:
 *
 *   - the tooltip fetches through the already-gated `useHouseholdMedical`,
 *     and ONLY once a staff member actually opens the bubble — never on card
 *     render, because ~82 cards eagerly fetching a medical payload is the
 *     speculative read that hook's `enabled` flag exists to prevent;
 *   - a user without `bunking.manage` sees today's label tooltip unchanged
 *     and triggers NO fetch — not a disabled one, none at all;
 *   - while loading, or when the family wrote nothing, the label alone is the
 *     tooltip. The label is the placeholder; there is no spinner in a bubble.
 *
 * Mocking follows `HousingNeedDetails.test.tsx`, which reads the same payload
 * through the same two hooks one panel further in.
 *
 * Fictional data throughout.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { FamilyCard } from './FamilyCard'

const isAdmin = { value: false }
const permissions = { value: new Set<string>() }
const medicalResult = {
  value: { data: undefined, isLoading: false, error: null } as {
    data: unknown
    isLoading: boolean
    error: Error | null
  },
}

const useHouseholdMedical = vi.fn(() => medicalResult.value)

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: isAdmin.value,
    permissions: [...permissions.value],
    hasPermission: (perm: string) => isAdmin.value || permissions.value.has(perm),
    hasAnyPermission: (...perms: string[]) =>
      isAdmin.value || perms.some((p) => permissions.value.has(p)),
  }),
}))

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: (...args: unknown[]) => useHouseholdMedical(...(args as [])),
}))

vi.mock('../../hooks/useCurrentYear', () => ({
  useYear: () => 2026,
}))

beforeEach(() => {
  isAdmin.value = false
  permissions.value = new Set()
  medicalResult.value = { data: undefined, isLoading: false, error: null }
  useHouseholdMedical.mockClear()
})

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 1000001,
    display_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

function confirmedUnit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
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
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: true,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

const BATHROOM_EXPLAIN = 'Riley uses a walker and cannot manage the path to the bathhouse.'
const CPAP_EXPLAIN = 'Samuel uses a CPAP and needs an outlet by the bed.'
const ACCOMMODATION_EXPLAIN = 'A ground-floor room, please — no steps at the door.'

describe('the manage user’s glyph tooltip', () => {
  beforeEach(() => {
    permissions.value = new Set(['bunking.manage'])
  })

  it('carries the family’s explain text once it has loaded', () => {
    medicalResult.value = {
      data: { bathroom_explain: BATHROOM_EXPLAIN },
      isLoading: false,
      error: null,
    }
    render(
      <FamilyCard
        party={party({
          flags: { needs_private_bathroom: true },
          effective_bathroom: 'private',
        })}
        unit={confirmedUnit()}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-bathroom'))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Bathroom in unit')
    expect(tooltip).toHaveTextContent(BATHROOM_EXPLAIN)
  })

  it('fetches through the gated medical hook, enabled, for this household and year', () => {
    medicalResult.value = { data: { cpap_info: CPAP_EXPLAIN }, isLoading: false, error: null }
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true } })}
        unit={confirmedUnit({ power_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-power'))
    expect(useHouseholdMedical).toHaveBeenCalledWith(2026, 1000001, true)
    // The power glyph's words are the CPAP disclosure — the field its flag
    // was derived from.
    expect(screen.getByRole('tooltip')).toHaveTextContent(CPAP_EXPLAIN)
  })

  it('keeps the unmet wording and appends the explain after it', () => {
    medicalResult.value = {
      data: { accommodation_explain: ACCOMMODATION_EXPLAIN },
      isLoading: false,
      error: null,
    }
    render(
      <FamilyCard
        party={party({ flags: { needs_fridge: true } })}
        unit={confirmedUnit({ fridge_coverage: 'none' })}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-fridge'))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Fridge — the cabin does not meet it')
    expect(tooltip).toHaveTextContent(ACCOMMODATION_EXPLAIN)
  })

  /*
   * THE DUPE GUARD, at the render level (owner ruling 2026-08-23). Step-free
   * used to quote the bathroom narrative as well, so a household that wrote one
   * bathroom explanation saw it twice -- once under the bathroom glyph and
   * again under step-free. The bathroom narrative now belongs to the bathroom
   * glyph alone.
   */
  it('shows step-free’s accommodation narrative and never the bathroom one', () => {
    medicalResult.value = {
      data: {
        bathroom_explain: BATHROOM_EXPLAIN,
        accommodation_explain: ACCOMMODATION_EXPLAIN,
      },
      isLoading: false,
      error: null,
    }
    render(
      <FamilyCard
        party={party({ flags: { needs_step_free: true } })}
        unit={confirmedUnit({ ramp_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-step_free'))
    const text = screen.getByRole('tooltip').textContent ?? ''
    expect(text).toContain(ACCOMMODATION_EXPLAIN)
    expect(text).not.toContain(BATHROOM_EXPLAIN)
  })

  it('shows the label alone while the payload is still loading — the label IS the placeholder', () => {
    medicalResult.value = { data: undefined, isLoading: true, error: null }
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true } })}
        unit={confirmedUnit({ power_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-power'))
    expect(screen.getByRole('tooltip').textContent).toBe('Power')
  })

  it('shows the label alone when the family wrote nothing in the mapped field', () => {
    medicalResult.value = {
      // The OTHER fields being populated must not leak into this glyph.
      data: { cpap_info: '', allergy_info: 'Peanuts', bathroom_explain: BATHROOM_EXPLAIN },
      isLoading: false,
      error: null,
    }
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true } })}
        unit={confirmedUnit({ power_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-power'))
    expect(screen.getByRole('tooltip').textContent).toBe('Power')
  })

  it('never fetches before a tooltip is opened — rendering cards is not interaction', () => {
    render(
      <>
        <FamilyCard
          party={party({ flags: { needs_power: true } })}
          unit={confirmedUnit({ power_coverage: 'all' })}
          onOpen={vi.fn()}
        />
        <FamilyCard
          party={party({ household_cm_id: 1000002, flags: { needs_fridge: true } })}
          unit={confirmedUnit({ fridge_coverage: 'all' })}
          onOpen={vi.fn()}
        />
        <FamilyCard
          party={party({ household_cm_id: 1000003, flags: { needs_step_free: true } })}
          unit={confirmedUnit({ ramp_coverage: 'all' })}
          onOpen={vi.fn()}
        />
      </>
    )
    expect(useHouseholdMedical).not.toHaveBeenCalled()
  })

  it('does not keep the explain in the page once the tooltip closes', () => {
    // kindred#2348's rule for the label applies with more force to a medical
    // disclosure: a closed tooltip renders NO text, so find-in-page cannot
    // surface a narrative nobody has open.
    medicalResult.value = {
      data: { bathroom_explain: BATHROOM_EXPLAIN },
      isLoading: false,
      error: null,
    }
    render(
      <FamilyCard
        party={party({
          flags: { needs_private_bathroom: true },
          effective_bathroom: 'private',
        })}
        unit={confirmedUnit()}
        onOpen={vi.fn()}
      />
    )
    const glyph = screen.getByTestId('need-glyph-bathroom')
    fireEvent.focus(glyph)
    expect(screen.getByRole('tooltip')).toHaveTextContent(BATHROOM_EXPLAIN)
    fireEvent.blur(glyph)
    expect(screen.queryByText(BATHROOM_EXPLAIN)).not.toBeInTheDocument()
  })

  it('does not fetch for a person-grain party — there is no household to look up', () => {
    // An adult weekend enrols the person; `household_cm_id` serialises as 0
    // there, and /households/0/medical is not a request worth making.
    render(
      <FamilyCard
        party={party({
          grain: 'person',
          household_cm_id: 0,
          flags: { needs_power: true },
        })}
        unit={confirmedUnit({ power_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-power'))
    expect(useHouseholdMedical).not.toHaveBeenCalled()
    expect(screen.getByRole('tooltip').textContent).toBe('Power')
  })
})

describe('the user without bunking.manage', () => {
  it('sees today’s label tooltip, unchanged', () => {
    medicalResult.value = {
      data: { bathroom_explain: BATHROOM_EXPLAIN },
      isLoading: false,
      error: null,
    }
    render(
      <FamilyCard
        party={party({
          flags: { needs_private_bathroom: true },
          effective_bathroom: 'private',
        })}
        unit={confirmedUnit()}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-bathroom'))
    expect(screen.getByRole('tooltip').textContent).toBe('Bathroom in unit')
  })

  it('triggers NO medical fetch — not a disabled one, none at all', () => {
    render(
      <FamilyCard
        party={party({ flags: { needs_power: true } })}
        unit={confirmedUnit({ power_coverage: 'all' })}
        onOpen={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByTestId('need-glyph-power'))
    expect(useHouseholdMedical).not.toHaveBeenCalled()
  })
})
