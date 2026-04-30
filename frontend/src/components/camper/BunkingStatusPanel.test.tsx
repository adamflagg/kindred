/**
 * Tests for BunkingStatusPanel — focused on the §15.1 resolved-only rule
 * for the per-camper request list.
 *
 * Audit 2026-04-29 found that personRequests was filtered only by
 * `r.request_type !== 'age_preference'`, so pending and declined rows
 * leaked into the rendered list with amber/red status dots while the
 * "X/Y met" summary used countableRequests (resolved-only). A user
 * with 3 pending + 1 resolved saw "1/1 met" alongside 4 row dots.
 */

import { MemoryRouter } from 'react-router'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { BunkingStatusPanel } from './BunkingStatusPanel'
import type { Camper, BunkRequest } from '../../types/app-types'
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
    ...(overrides as Partial<BunkRequest>),
  } as EnhancedBunkRequest
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

describe('BunkingStatusPanel — §15.1 resolved-only request list', () => {
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
