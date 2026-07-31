/**
 * Accessibility flags are derived booleans. The medical NARRATIVE is behind
 * an explicit, permission-checked reveal (spec §5).
 *
 * `lodging.phi` is currently granted to no role, so in practice only admins
 * reach the narrative. The list must therefore degrade gracefully rather than
 * treat a 403 as a page failure.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccessibilityFlags } from '../../types/lodging'
import { AccessibilityFlagList } from './AccessibilityFlagList'

const isAdmin = { value: false }
const permissions = { value: new Set<string>() }
const medicalResult = {
  value: { data: undefined, isLoading: false, error: null } as {
    data: unknown
    isLoading: boolean
    error: Error | null
  },
}

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
  useHouseholdMedical: () => medicalResult.value,
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function flags(overrides: Partial<AccessibilityFlags> = {}): AccessibilityFlags {
  return {
    needs_private_bathroom: false,
    needs_power: false,
    needs_accommodation: false,
    accommodation_is_mandatory: false,
    has_infant: false,
    has_medical_narrative: false,
    ...overrides,
  }
}

beforeEach(() => {
  isAdmin.value = false
  permissions.value = new Set()
  medicalResult.value = { data: undefined, isLoading: false, error: null }
})

describe('derived flags', () => {
  it('renders the private-bathroom need', () => {
    render(
      <AccessibilityFlagList
        flags={flags({ needs_private_bathroom: true })}
        householdCmId={2000001}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('Private bathroom')).toBeInTheDocument()
  })

  it('renders the power need (CPAP)', () => {
    render(
      <AccessibilityFlagList
        flags={flags({ needs_power: true })}
        householdCmId={2000001}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('Power')).toBeInTheDocument()
  })

  it('treats power and private bathroom as INDEPENDENT needs', () => {
    // The CPAP / adult-infant source fields are multi-option, not boolean, and
    // one option carries both needs. A household can need power without a
    // private bathroom and vice versa; neither implies the other.
    render(
      <AccessibilityFlagList
        flags={flags({ needs_power: true, needs_private_bathroom: false })}
        householdCmId={2000001}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('Power')).toBeInTheDocument()
    expect(screen.queryByText('Private bathroom')).not.toBeInTheDocument()
  })

  it('renders the infant flag', () => {
    render(
      <AccessibilityFlagList
        flags={flags({ has_infant: true })}
        householdCmId={2000001}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('Infant in party')).toBeInTheDocument()
  })

  it('distinguishes a mandatory accommodation from a preference', () => {
    const { rerender } = render(
      <AccessibilityFlagList
        flags={flags({ needs_accommodation: true, accommodation_is_mandatory: true })}
        householdCmId={2000001}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('Accommodation required')).toBeInTheDocument()

    rerender(
      <AccessibilityFlagList
        flags={flags({ needs_accommodation: true, accommodation_is_mandatory: false })}
        householdCmId={2000001}
        year={2026}
      />
    )
    expect(screen.getByText('Accommodation requested')).toBeInTheDocument()
  })

  it('renders nothing when no flag is set', () => {
    const { container } = render(
      <AccessibilityFlagList flags={flags()} householdCmId={2000001} year={2026} />,
      { wrapper }
    )
    expect(container.textContent).toBe('')
  })
})

describe('PHI reveal gate', () => {
  it('hides the reveal from a user without lodging.phi', () => {
    render(
      <AccessibilityFlagList
        flags={flags({ has_medical_narrative: true })}
        householdCmId={2000001}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.queryByRole('button', { name: /medical detail/i })).not.toBeInTheDocument()
    expect(screen.getByText('Medical detail on file')).toBeInTheDocument()
  })

  it('offers the reveal to a user holding lodging.phi', () => {
    permissions.value = new Set(['lodging.phi'])
    render(
      <AccessibilityFlagList
        flags={flags({ has_medical_narrative: true })}
        householdCmId={2000001}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByRole('button', { name: /medical detail/i })).toBeInTheDocument()
  })

  it('offers the reveal to an admin, who bypasses the permission check', () => {
    // lodging.phi is granted to no role, so admin bypass is the only route
    // that currently reaches the narrative in practice.
    isAdmin.value = true
    render(
      <AccessibilityFlagList
        flags={flags({ has_medical_narrative: true })}
        householdCmId={2000001}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByRole('button', { name: /medical detail/i })).toBeInTheDocument()
  })

  it('renders no medical affordance at all when there is no narrative', () => {
    isAdmin.value = true
    render(<AccessibilityFlagList flags={flags()} householdCmId={2000001} year={2026} />, {
      wrapper,
    })
    expect(screen.queryByText('Medical detail on file')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /medical detail/i })).not.toBeInTheDocument()
  })

  it('offers no reveal for a party with no household to look up', () => {
    // An adult weekend enrols the person, not a household, so there is no
    // household id to fetch a narrative by. A button that can only ever
    // request /households/0/medical is worse than no button.
    isAdmin.value = true
    render(
      <AccessibilityFlagList
        flags={flags({ has_medical_narrative: true })}
        householdCmId={null}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.queryByRole('button', { name: /medical detail/i })).not.toBeInTheDocument()
    expect(screen.getByText('Medical detail on file')).toBeInTheDocument()
  })
})

describe('the revealed narrative', () => {
  async function reveal() {
    isAdmin.value = true
    render(
      <AccessibilityFlagList
        flags={flags({ has_medical_narrative: true })}
        householdCmId={2000001}
        year={2026}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /show medical detail/i }))
  }

  it('renders each populated field under its own label', async () => {
    medicalResult.value = {
      data: { cpap_info: 'Needs an outlet by the bed', allergy_info: 'Peanuts' },
      isLoading: false,
      error: null,
    }
    await reveal()
    expect(screen.getByText('CPAP')).toBeInTheDocument()
    expect(screen.getByText('Needs an outlet by the bed')).toBeInTheDocument()
    expect(screen.getByText('Allergies')).toBeInTheDocument()
    expect(screen.getByText('Peanuts')).toBeInTheDocument()
  })

  it('omits the fields the household left blank', async () => {
    medicalResult.value = {
      data: { cpap_info: 'Needs an outlet by the bed', allergy_info: '' },
      isLoading: false,
      error: null,
    }
    await reveal()
    expect(screen.getByText('CPAP')).toBeInTheDocument()
    expect(screen.queryByText('Allergies')).not.toBeInTheDocument()
  })

  it('says it is loading while the request is in flight', async () => {
    medicalResult.value = { data: undefined, isLoading: true, error: null }
    await reveal()
    expect(screen.getByText(/Loading medical detail/)).toBeInTheDocument()
  })

  it('renders a failure inline rather than failing the page', async () => {
    // lodging.phi is granted to no role, so a 403 is the common case. It must
    // read as a sentence in the row, not escalate to the ErrorBoundary.
    medicalResult.value = {
      data: undefined,
      isLoading: false,
      error: new Error('Forbidden: lodging.phi required'),
    }
    await reveal()
    expect(screen.getByText('Forbidden: lodging.phi required')).toBeInTheDocument()
  })

  it('hides the narrative again when the reveal is toggled off', async () => {
    medicalResult.value = { data: { allergy_info: 'Peanuts' }, isLoading: false, error: null }
    await reveal()
    expect(screen.getByText('Peanuts')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /hide medical detail/i }))
    expect(screen.queryByText('Peanuts')).not.toBeInTheDocument()
  })
})
