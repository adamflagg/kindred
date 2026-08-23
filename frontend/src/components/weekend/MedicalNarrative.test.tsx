/**
 * The medical narrative, split out of `AccessibilityFlagList` by kindred#1889.
 *
 * Two things changed at once and this file pins both.
 *
 * **There is no reveal button.** It existed to gate a disclosure that
 * `has_medical_narrative` claimed was worth gating — a flag true for 745/745
 * households, so the button was on every row and gated nothing. With the flag
 * deleted, the honest rule is the one the API already enforces: a
 * `bunking.manage` holder sees the narrative, and everyone else sees no trace
 * that one exists. Telling a non-holder "there is a disclosure you cannot
 * read" is the only thing the old copy achieved.
 *
 * **It renders in the panel, never in a row.** One household at a time, which
 * is what makes an always-on fetch acceptable: `useHouseholdMedical` keeps
 * `staleTime: 0, gcTime: 0` so the narrative does not sit in the cache after
 * the panel closes.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Permission } from '../../constants/permissions'
import { MedicalNarrative } from './MedicalNarrative'

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

beforeEach(() => {
  isAdmin.value = false
  permissions.value = new Set()
  medicalResult.value = { data: undefined, isLoading: false, error: null }
  useHouseholdMedical.mockClear()
})

/** Grants `bunking.manage` and renders the narrative for a fixed household. */
function renderWithPermission() {
  permissions.value = new Set([Permission.BUNKING_MANAGE])
  return render(<MedicalNarrative householdCmId={1} year={2026} />)
}

describe('the permission gate', () => {
  it('renders nothing for a user without bunking.manage', () => {
    medicalResult.value = { data: { allergy_info: 'Peanuts' }, isLoading: false, error: null }
    const { container } = render(<MedicalNarrative householdCmId={2000001} year={2026} />)
    expect(container.textContent).toBe('')
  })

  it('does not fetch for a user without bunking.manage', () => {
    render(<MedicalNarrative householdCmId={2000001} year={2026} />)
    expect(useHouseholdMedical).toHaveBeenCalledWith(2026, 2000001, false)
  })

  it('renders for a holder of bunking.manage', () => {
    permissions.value = new Set(['bunking.manage'])
    medicalResult.value = { data: { allergy_info: 'Peanuts' }, isLoading: false, error: null }
    render(<MedicalNarrative householdCmId={2000001} year={2026} />)
    expect(screen.getByText('Peanuts')).toBeInTheDocument()
  })

  it('renders for an admin, who bypasses the permission check', () => {
    // An admin holds no explicit permissions; hasPermission short-circuits on
    // is_admin, so this must render without bunking.manage in the set.
    isAdmin.value = true
    medicalResult.value = { data: { allergy_info: 'Peanuts' }, isLoading: false, error: null }
    render(<MedicalNarrative householdCmId={2000001} year={2026} />)
    expect(screen.getByText('Peanuts')).toBeInTheDocument()
  })

  it('does not fetch for a party with no household to look up', () => {
    // An adult weekend enrols the person, not a household, so there is nothing
    // to look a narrative up by. Fetching would request /households/0/medical.
    isAdmin.value = true
    render(<MedicalNarrative householdCmId={null} year={2026} />)
    expect(useHouseholdMedical).toHaveBeenCalledWith(2026, null, false)
  })
})

describe('the narrative itself', () => {
  beforeEach(() => {
    isAdmin.value = true
  })

  it('renders without any click', () => {
    // The whole point of the change: no button, no toggle, no second step.
    medicalResult.value = { data: { allergy_info: 'Peanuts' }, isLoading: false, error: null }
    render(<MedicalNarrative householdCmId={2000001} year={2026} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Peanuts')).toBeInTheDocument()
  })

  it('renders each populated field under its own label', () => {
    medicalResult.value = {
      data: { cpap_info: 'Needs an outlet by the bed', allergy_info: 'Peanuts' },
      isLoading: false,
      error: null,
    }
    render(<MedicalNarrative householdCmId={2000001} year={2026} />)

    expect(screen.getByText('CPAP')).toBeInTheDocument()
    expect(screen.getByText('Needs an outlet by the bed')).toBeInTheDocument()
    expect(screen.getByText('Allergies')).toBeInTheDocument()
    expect(screen.getByText('Peanuts')).toBeInTheDocument()
  })

  it('omits the fields the household left blank', () => {
    medicalResult.value = {
      data: { cpap_info: 'Needs an outlet by the bed', allergy_info: '' },
      isLoading: false,
      error: null,
    }
    render(<MedicalNarrative householdCmId={2000001} year={2026} />)

    expect(screen.getByText('CPAP')).toBeInTheDocument()
    expect(screen.queryByText('Allergies')).not.toBeInTheDocument()
  })

  it('renders nothing when every field is blank', () => {
    // A household with a row but nothing on it. There is no flag to consult
    // any more, so emptiness is discovered from the payload — and an empty
    // red-bordered box would read as a disclosure that is failing to load.
    medicalResult.value = {
      data: { cpap_info: '', allergy_info: '' },
      isLoading: false,
      error: null,
    }
    const { container } = render(<MedicalNarrative householdCmId={2000001} year={2026} />)

    expect(container.textContent).toBe('')
  })

  it('says it is loading while the request is in flight', () => {
    medicalResult.value = { data: undefined, isLoading: true, error: null }
    render(<MedicalNarrative householdCmId={2000001} year={2026} />)

    expect(screen.getByText(/Loading medical detail/)).toBeInTheDocument()
  })

  it('renders a failure inline rather than failing the page', () => {
    // The roster is readable by any authenticated user while bunking.manage is
    // held by admins and Bunking Staff, so a 403 here is a common case even
    // after the gate above — permissions can change between page load and
    // fetch. It must read as a sentence, not escalate to the ErrorBoundary.
    medicalResult.value = {
      data: undefined,
      isLoading: false,
      error: new Error('Forbidden: bunking.manage required'),
    }
    render(<MedicalNarrative householdCmId={2000001} year={2026} />)

    expect(screen.getByText('Forbidden: bunking.manage required')).toBeInTheDocument()
  })
})

describe('the gate pill', () => {
  it('renders a pill for an answered gate and the family text below it', () => {
    medicalResult.value = {
      data: { allergy_gate: 'yes', allergy_info: 'carries an epinephrine auto-injector' },
      isLoading: false,
      error: null,
    }
    renderWithPermission()

    expect(screen.getByText('Allergies')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('carries an epinephrine auto-injector')).toBeInTheDocument()
  })

  it('renders the pill with no paragraph when the family wrote nothing', () => {
    medicalResult.value = {
      data: { allergy_gate: 'no', allergy_info: '' },
      isLoading: false,
      error: null,
    }
    renderWithPermission()

    expect(screen.getByText('Allergies')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('renders nothing for a gate the household never answered', () => {
    medicalResult.value = {
      data: { allergy_gate: 'unknown', allergy_info: '' },
      isLoading: false,
      error: null,
    }
    renderWithPermission()

    // 375 of 900 households in 2026 answer some gates and not others. An
    // unanswered gate is not a denial and must not render as one.
    expect(screen.queryByText('Allergies')).not.toBeInTheDocument()
  })

  it('renders a narrative that has no gate at all', () => {
    medicalResult.value = {
      data: { additional_info: 'gluten free kitchen requested' },
      isLoading: false,
      error: null,
    }
    renderWithPermission()

    expect(screen.getByText('Additional')).toBeInTheDocument()
    expect(screen.getByText('gluten free kitchen requested')).toBeInTheDocument()
    expect(screen.queryByText('Yes')).not.toBeInTheDocument()
    expect(screen.queryByText('No')).not.toBeInTheDocument()
  })

  it('renders no block at all when every gate is unanswered and every column blank', () => {
    medicalResult.value = {
      data: { allergy_gate: 'unknown', allergy_info: '', additional_info: '' },
      isLoading: false,
      error: null,
    }
    const { container } = renderWithPermission()

    expect(container).toBeEmptyDOMElement()
  })
})
