/**
 * Tests for BunkingStatusPanel — pin the resolved-only filter on the
 * per-camper request list.
 *
 * Earlier iterations filtered only by `r.request_type !== 'age_preference'`,
 * so pending and declined rows leaked into the rendered list with amber/red
 * status dots while the "X/Y met" summary used countableRequests
 * (resolved-only). A user with 3 pending + 1 resolved saw "1/1 met" next to
 * 4 row dots.
 */

import { MemoryRouter } from 'react-router'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { BunkingStatusPanel } from './BunkingStatusPanel'
import type { Camper } from '../../types/app-types'
import type { EnhancedBunkRequest } from '../../hooks/camper/useAllBunkRequests'

function makeCamper(): Camper {
  return {
    id: '12345:1000001',
    name: 'Emma Johnson',
    age: 12,
    grade: 7,
    gender: 'F',
    session_cm_id: 1000001,
    person_cm_id: 12345,
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
  }
}

function makeRequest(overrides: Partial<EnhancedBunkRequest>): EnhancedBunkRequest {
  return {
    id: 'req-1',
    requester_id: 12345,
    requestee_id: 67890,
    request_type: 'bunk_with',
    year: 2025,
    session_id: 1000001,
    status: 'resolved',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    requestedPersonName: 'Liam Garcia',
    ...overrides,
  }
}

function renderPanel(allBunkRequests: EnhancedBunkRequest[]) {
  return render(
    <MemoryRouter>
      <BunkingStatusPanel
        camper={makeCamper()}
        sessionShortName="S1"
        allBunkRequests={allBunkRequests}
        agePreferenceRequests={[]}
        satisfactionData={{}}
        satisfactionLoading={false}
      />
    </MemoryRouter>
  )
}

interface RenderPanelOptions {
  allBunkRequests: EnhancedBunkRequest[]
  agePreferenceRequests?: EnhancedBunkRequest[]
  satisfactionData: Record<
    string,
    { status: 'satisfied' | 'not_satisfied' | 'checking' | 'unknown'; detail?: string }
  >
}

function renderPanelWith({
  allBunkRequests,
  agePreferenceRequests = [],
  satisfactionData,
}: RenderPanelOptions) {
  return render(
    <MemoryRouter>
      <BunkingStatusPanel
        camper={makeCamper()}
        sessionShortName="S1"
        allBunkRequests={allBunkRequests}
        agePreferenceRequests={agePreferenceRequests}
        satisfactionData={satisfactionData}
        satisfactionLoading={false}
      />
    </MemoryRouter>
  )
}

describe('BunkingStatusPanel — resolved-only request list', () => {
  it('does not render pending bunk_with rows in the per-camper request list', () => {
    const requests: EnhancedBunkRequest[] = [
      makeRequest({
        id: 'req-resolved',
        status: 'resolved',
        requestee_id: 67890,
        requestedPersonName: 'Liam Garcia',
      }),
      makeRequest({
        id: 'req-pending',
        status: 'pending',
        requestee_id: 67891,
        requestedPersonName: 'Olivia Chen',
      }),
    ]

    renderPanel(requests)

    expect(screen.getByText('Liam Garcia')).toBeTruthy()
    expect(screen.queryByText('Olivia Chen')).toBeNull()
  })

  it('does not render declined rows in the per-camper request list', () => {
    const requests: EnhancedBunkRequest[] = [
      makeRequest({
        id: 'req-resolved',
        status: 'resolved',
        requestee_id: 67890,
        requestedPersonName: 'Liam Garcia',
      }),
      makeRequest({
        id: 'req-declined',
        status: 'declined',
        requestee_id: 67892,
        requestedPersonName: 'Riley Sam',
      }),
    ]

    renderPanel(requests)

    expect(screen.getByText('Liam Garcia')).toBeTruthy()
    expect(screen.queryByText('Riley Sam')).toBeNull()
  })

  it('shows the empty state when only non-resolved rows are present', () => {
    const requests: EnhancedBunkRequest[] = [
      makeRequest({
        id: 'req-pending',
        status: 'pending',
        requestee_id: 67891,
        requestedPersonName: 'Olivia Chen',
      }),
      makeRequest({
        id: 'req-declined',
        status: 'declined',
        requestee_id: 67892,
        requestedPersonName: 'Riley Sam',
      }),
    ]

    renderPanel(requests)

    expect(screen.getByText(/no bunk requests on file/i)).toBeTruthy()
    expect(screen.queryByText('Olivia Chen')).toBeNull()
    expect(screen.queryByText('Riley Sam')).toBeNull()
  })
})

describe('BunkingStatusPanel — Stage 3b.1 two-column summary line', () => {
  it('renders two columns when both materialParent and staff have requests', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        source: 'family',
      }),
      makeRequest({
        id: 's1',
        request_type: 'not_bunk_with',
        source_field: 'not_bunk_with',
        source: 'staff',
      }),
    ]
    const satisfactionData = {
      p1: { status: 'satisfied' as const, detail: '' },
      s1: { status: 'satisfied' as const, detail: '' },
    }
    renderPanelWith({ allBunkRequests, satisfactionData })
    expect(screen.getByText(/Parent request satisfaction:/i)).toBeInTheDocument()
    expect(screen.getByText(/Staff request satisfaction:/i)).toBeInTheDocument()
  })

  it('renders single Parent line when only parent material requests', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        source: 'family',
      }),
    ]
    const satisfactionData = { p1: { status: 'satisfied' as const, detail: '' } }
    renderPanelWith({ allBunkRequests, satisfactionData })
    expect(screen.getByText(/Parent request satisfaction:/i)).toBeInTheDocument()
    expect(screen.queryByText(/Staff request satisfaction:/i)).toBeNull()
  })

  it('renders single Staff line when only staff requests', () => {
    const allBunkRequests = [
      makeRequest({
        id: 's1',
        request_type: 'not_bunk_with',
        source_field: 'not_bunk_with',
        source: 'staff',
      }),
    ]
    const satisfactionData = { s1: { status: 'satisfied' as const, detail: '' } }
    renderPanelWith({ allBunkRequests, satisfactionData })
    expect(screen.getByText(/Staff request satisfaction:/i)).toBeInTheDocument()
    expect(screen.queryByText(/Parent request satisfaction:/i)).toBeNull()
  })

  it('hides summary entirely when only best-effort parent (no material, no staff)', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'b1',
        request_type: 'age_preference',
        source_field: 'socialize_with',
        source: 'family',
        age_preference_target: 'older',
      }),
    ]
    const satisfactionData = { b1: { status: 'satisfied' as const, detail: '' } }
    renderPanelWith({ allBunkRequests, satisfactionData })
    expect(screen.queryByText(/Parent request satisfaction:/i)).toBeNull()
    expect(screen.queryByText(/Staff request satisfaction:/i)).toBeNull()
  })

  it('shows green check when ratio is 1.0', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        source: 'family',
      }),
    ]
    const satisfactionData = { p1: { status: 'satisfied' as const, detail: '' } }
    const { container } = renderPanelWith({ allBunkRequests, satisfactionData })
    const greenCheck = container.querySelector('.text-green-500, .text-green-400, .text-green-600')
    expect(greenCheck).not.toBeNull()
  })
})

describe('BunkingStatusPanel — Stage 3b.1 R3 row list', () => {
  it('renders Parent rows before Staff sub-divider before Staff rows', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        source: 'family',
        ...({
          targetPerson: { first_name: 'Emma', last_name: 'Johnson', cm_id: 100 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
      makeRequest({
        id: 's1',
        request_type: 'not_bunk_with',
        source_field: 'not_bunk_with',
        source: 'staff',
        ...({
          targetPerson: { first_name: 'Riley', last_name: 'Sam', cm_id: 200 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
    ]
    const satisfactionData = {
      p1: { status: 'satisfied' as const, detail: '' },
      s1: { status: 'satisfied' as const, detail: '' },
    }
    const { container } = renderPanelWith({ allBunkRequests, satisfactionData })
    const text = container.textContent ?? ''
    const emmaIdx = text.indexOf('Emma')
    const staffIdx = text.indexOf('Staff')
    const rileyIdx = text.indexOf('Riley')
    expect(emmaIdx).toBeGreaterThan(-1)
    expect(staffIdx).toBeGreaterThan(emmaIdx)
    expect(rileyIdx).toBeGreaterThan(staffIdx)
  })

  it('omits Staff sub-divider when no staff rows exist', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        source: 'family',
        ...({
          targetPerson: { first_name: 'Emma', last_name: 'Johnson', cm_id: 100 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
    ]
    const satisfactionData = { p1: { status: 'satisfied' as const, detail: '' } }
    const { container } = renderPanelWith({ allBunkRequests, satisfactionData })
    // The bare word "Staff" should not appear as a divider label.
    // Note: this is a heuristic — if the existing UI uses "Staff" in some other
    // context (e.g. an alert label), the assertion may need refining. For now
    // assert no divider element with the literal text "Staff" exists.
    const dividers = Array.from(container.querySelectorAll('*')).filter(
      (el) => el.textContent?.trim() === 'Staff'
    )
    expect(dividers.length).toBe(0)
  })

  it('sorts Parent rows alphabetically by requestee first_name', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p-olivia',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        source: 'family',
        ...({
          targetPerson: { first_name: 'Olivia', last_name: 'Chen', cm_id: 100 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
      makeRequest({
        id: 'p-emma',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        source: 'family',
        ...({
          targetPerson: { first_name: 'Emma', last_name: 'Johnson', cm_id: 101 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
      makeRequest({
        id: 'p-liam',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        source: 'family',
        ...({
          targetPerson: { first_name: 'Liam', last_name: 'Garcia', cm_id: 102 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
    ]
    const satisfactionData = Object.fromEntries(
      allBunkRequests.map((r) => [r.id, { status: 'satisfied' as const, detail: '' }])
    )
    const { container } = renderPanelWith({ allBunkRequests, satisfactionData })
    const text = container.textContent ?? ''
    expect(text.indexOf('Emma')).toBeLessThan(text.indexOf('Liam'))
    expect(text.indexOf('Liam')).toBeLessThan(text.indexOf('Olivia'))
  })

  it('renders animated sparkle + P badge on material age preference', () => {
    const ageReq = makeRequest({
      id: 'a1',
      request_type: 'age_preference',
      source_field: 'bunk_with',
      source: 'family',
      age_preference_target: 'older',
    })
    const allBunkRequests = [ageReq]
    const agePreferenceRequests = [ageReq]
    const satisfactionData = { a1: { status: 'satisfied' as const, detail: '' } }
    const { container } = renderPanelWith({
      allBunkRequests,
      agePreferenceRequests,
      satisfactionData,
    })
    expect(container.querySelector('.sparkle-material')).not.toBeNull()
    expect(screen.getByText('P')).toBeInTheDocument()
  })

  it('renders S badge on staff-source age preference', () => {
    const ageReq = makeRequest({
      id: 'a1',
      request_type: 'age_preference',
      source_field: 'bunking_notes',
      source: 'staff',
      age_preference_target: 'younger',
    })
    const allBunkRequests = [ageReq]
    const agePreferenceRequests = [ageReq]
    const satisfactionData = { a1: { status: 'satisfied' as const, detail: '' } }
    renderPanelWith({ allBunkRequests, agePreferenceRequests, satisfactionData })
    expect(screen.getByText('S')).toBeInTheDocument()
  })
})
