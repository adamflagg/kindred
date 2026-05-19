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
import { SourceField } from '../../types/sourceField'
import type { Camper } from '../../types/app-types'
import type { EnhancedBunkRequest } from '../../hooks/camper/useAllBunkRequests'
import type { CamperSatisfaction, SatisfactionEntry } from '../../types/satisfaction'
import { emptyCamperSatisfaction } from '../../types/satisfaction'

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

/**
 * Factory for building a CamperSatisfaction with optional overrides.
 * Tests that need specific counted_totals or per_request structures pass them
 * explicitly via overrides.
 */
function makeCamperSatisfaction(overrides?: Partial<CamperSatisfaction>): CamperSatisfaction {
  const empty = emptyCamperSatisfaction(12345)
  return { ...empty, ...overrides }
}

/** Empty lookup — every request returns {satisfied: null, detail: null}, no pills. */
const emptyLookup = (): SatisfactionEntry => ({ satisfied: null, detail: null })

function renderPanel(allBunkRequests: EnhancedBunkRequest[]) {
  return render(
    <MemoryRouter>
      <BunkingStatusPanel
        camper={makeCamper()}
        sessionShortName="S1"
        allBunkRequests={allBunkRequests}
        agePreferenceRequests={[]}
        getRequestSatisfaction={emptyLookup}
        camperSatisfaction={makeCamperSatisfaction()}
      />
    </MemoryRouter>
  )
}

interface RenderPanelOptions {
  allBunkRequests: EnhancedBunkRequest[]
  agePreferenceRequests?: EnhancedBunkRequest[]
  /** Map from request id → SatisfactionEntry. Missing keys default to {null, null}. */
  satisfactionData: Record<string, SatisfactionEntry>
  camperSatisfaction?: CamperSatisfaction
}

function renderPanelWith({
  allBunkRequests,
  agePreferenceRequests = [],
  satisfactionData,
  camperSatisfaction,
}: RenderPanelOptions) {
  const getRequestSatisfaction = (id: string): SatisfactionEntry =>
    satisfactionData[id] ?? { satisfied: null, detail: null }
  return render(
    <MemoryRouter>
      <BunkingStatusPanel
        camper={makeCamper()}
        sessionShortName="S1"
        allBunkRequests={allBunkRequests}
        agePreferenceRequests={agePreferenceRequests}
        getRequestSatisfaction={getRequestSatisfaction}
        camperSatisfaction={camperSatisfaction ?? makeCamperSatisfaction()}
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
      }),
      makeRequest({
        id: 's1',
        request_type: 'not_bunk_with',
        source_field: 'not_bunk_with',
      }),
    ]
    const satisfactionData = {
      p1: { satisfied: true, detail: null },
      s1: { satisfied: true, detail: null },
    }
    const camperSatisfaction = makeCamperSatisfaction({
      counted_totals: {
        material_parent: { total: 1, satisfied: 1 },
        staff: { total: 1, satisfied: 1 },
      },
    })
    renderPanelWith({ allBunkRequests, satisfactionData, camperSatisfaction })
    expect(screen.getByText(/Parent request satisfaction:/i)).toBeInTheDocument()
    expect(screen.getByText(/Staff request satisfaction:/i)).toBeInTheDocument()
  })

  it('renders single Parent line when only parent material requests', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
      }),
    ]
    const satisfactionData = { p1: { satisfied: true, detail: null } }
    const camperSatisfaction = makeCamperSatisfaction({
      counted_totals: {
        material_parent: { total: 1, satisfied: 1 },
        staff: { total: 0, satisfied: 0 },
      },
    })
    renderPanelWith({ allBunkRequests, satisfactionData, camperSatisfaction })
    expect(screen.getByText(/Parent request satisfaction:/i)).toBeInTheDocument()
    expect(screen.queryByText(/Staff request satisfaction:/i)).toBeNull()
  })

  it('renders single Staff line when only staff requests', () => {
    const allBunkRequests = [
      makeRequest({
        id: 's1',
        request_type: 'not_bunk_with',
        source_field: 'not_bunk_with',
      }),
    ]
    const satisfactionData = { s1: { satisfied: true, detail: null } }
    const camperSatisfaction = makeCamperSatisfaction({
      counted_totals: {
        material_parent: { total: 0, satisfied: 0 },
        staff: { total: 1, satisfied: 1 },
      },
    })
    renderPanelWith({ allBunkRequests, satisfactionData, camperSatisfaction })
    expect(screen.getByText(/Staff request satisfaction:/i)).toBeInTheDocument()
    expect(screen.queryByText(/Parent request satisfaction:/i)).toBeNull()
  })

  it('hides summary entirely when only best-effort parent (no material, no staff)', () => {
    const bestEffortAgePref = makeRequest({
      id: 'b1',
      request_type: 'age_preference',
      source_field: 'socialize_with',
      age_preference_target: 'older',
    })
    const satisfactionData = { b1: { satisfied: true, detail: null } }
    renderPanelWith({
      allBunkRequests: [bestEffortAgePref],
      agePreferenceRequests: [bestEffortAgePref],
      satisfactionData,
    })
    expect(screen.queryByText(/Parent request satisfaction:/i)).toBeNull()
    expect(screen.queryByText(/Staff request satisfaction:/i)).toBeNull()
  })

  it('shows Parent line for material parent age preference (source_field=bunk_request_form)', () => {
    const materialAgePref = makeRequest({
      id: 'a1',
      request_type: 'age_preference',
      source_field: SourceField.BUNK_REQUEST_FORM,
      age_preference_target: 'older',
    })
    const satisfactionData = { a1: { satisfied: true, detail: null } }
    renderPanelWith({
      allBunkRequests: [materialAgePref],
      agePreferenceRequests: [materialAgePref],
      satisfactionData,
    })
    expect(screen.getByText(/Parent request satisfaction:/i)).toBeInTheDocument()
  })

  it('shows Staff line for staff age preference (source=staff)', () => {
    const staffAgePref = makeRequest({
      id: 'a2',
      request_type: 'age_preference',
      source_field: 'bunking_notes',
      age_preference_target: 'younger',
    })
    const satisfactionData = { a2: { satisfied: true, detail: null } }
    const camperSatisfaction = makeCamperSatisfaction({
      counted_totals: {
        material_parent: { total: 0, satisfied: 0 },
        staff: { total: 1, satisfied: 1 },
      },
    })
    renderPanelWith({
      allBunkRequests: [staffAgePref],
      agePreferenceRequests: [staffAgePref],
      satisfactionData,
      camperSatisfaction,
    })
    expect(screen.getByText(/Staff request satisfaction:/i)).toBeInTheDocument()
  })

  it('shows green check when ratio is 1.0', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
      }),
    ]
    const satisfactionData = { p1: { satisfied: true, detail: null } }
    const camperSatisfaction = makeCamperSatisfaction({
      counted_totals: {
        material_parent: { total: 1, satisfied: 1 },
        staff: { total: 0, satisfied: 0 },
      },
    })
    renderPanelWith({ allBunkRequests, satisfactionData, camperSatisfaction })
    // Scope to the parent-summary block so unrelated green elements (e.g. the
    // satisfied-row "Met" pill) can't false-pass the assertion.
    const parentSummary = screen.getByText(/Parent request satisfaction:/i).closest('div')
    expect(parentSummary).not.toBeNull()
    const greenCheck = parentSummary?.querySelector(
      '.text-green-500, .text-green-400, .text-green-600'
    )
    expect(greenCheck).not.toBeNull()
  })
})

describe('BunkingStatusPanel — #1159 reads counted_totals from CamperSatisfaction', () => {
  it('shows ratios from counted_totals.material_parent regardless of local request rows', () => {
    // Only one resolved row in allBunkRequests, but counted_totals reports 3/5.
    // The slice line must report "3/5 met" — proving slices come from
    // counted_totals (centralized aggregator), not from re-bucketing rows.
    const onlyRow = makeRequest({
      id: 'p1',
      request_type: 'bunk_with',
      source_field: 'bunk_with',
    })
    const camperSatisfaction: CamperSatisfaction = {
      ...emptyCamperSatisfaction(12345),
      counted_totals: {
        material_parent: { total: 5, satisfied: 3 },
        staff: { total: 0, satisfied: 0 },
      },
    }
    renderPanelWith({
      allBunkRequests: [onlyRow],
      satisfactionData: { p1: { satisfied: true, detail: null } },
      camperSatisfaction,
    })
    expect(screen.getByText('3/5 met')).toBeInTheDocument()
  })

  it('shows ratios from counted_totals.staff', () => {
    const camperSatisfaction: CamperSatisfaction = {
      ...emptyCamperSatisfaction(12345),
      counted_totals: {
        material_parent: { total: 0, satisfied: 0 },
        staff: { total: 4, satisfied: 1 },
      },
    }
    renderPanelWith({
      allBunkRequests: [],
      satisfactionData: {},
      camperSatisfaction,
    })
    expect(screen.getByText('1/4 met')).toBeInTheDocument()
    expect(screen.getByText(/Staff request satisfaction:/i)).toBeInTheDocument()
    expect(screen.queryByText(/Parent request satisfaction:/i)).toBeNull()
  })

  it('hides summary entirely when both counted_totals are zero', () => {
    const camperSatisfaction: CamperSatisfaction = emptyCamperSatisfaction(12345)
    renderPanelWith({
      allBunkRequests: [],
      satisfactionData: {},
      camperSatisfaction,
    })
    expect(screen.queryByText(/Parent request satisfaction:/i)).toBeNull()
    expect(screen.queryByText(/Staff request satisfaction:/i)).toBeNull()
  })
})

describe('BunkingStatusPanel — #1172 source_field/source fallback when /api/satisfaction unavailable', () => {
  // PR #1158 made the badges depend on bucketByRequestId, sourced from
  // /api/satisfaction. When that endpoint is down (#1171), the map is empty
  // and badges silently disappear. Pre-1158 behavior was driven from each
  // request's own source_field/source — local data, can't fail. The fallback
  // restores that resilience: centralized path stays canonical when present;
  // when bucket is undefined, fall back to the row's source_field/source.

  it('renders P badge from source_field=bunk_request_form when per_request is empty', () => {
    // Simulates /api/satisfaction returning emptyCamperSatisfaction (e.g. 500).
    const ageReq = makeRequest({
      id: 'no-bucket',
      request_type: 'age_preference',
      source_field: SourceField.BUNK_REQUEST_FORM,
      age_preference_target: 'older',
    })
    renderPanelWith({
      allBunkRequests: [],
      agePreferenceRequests: [ageReq],
      satisfactionData: {},
      camperSatisfaction: emptyCamperSatisfaction(12345),
    })
    expect(screen.getByText('P')).toBeInTheDocument()
    expect(screen.queryByText('S')).toBeNull()
  })

  it('renders S badge from source=staff when per_request is empty', () => {
    const ageReq = makeRequest({
      id: 'no-bucket-staff',
      request_type: 'age_preference',
      source_field: 'bunking_notes',
      age_preference_target: 'younger',
    })
    renderPanelWith({
      allBunkRequests: [],
      agePreferenceRequests: [ageReq],
      satisfactionData: {},
      camperSatisfaction: emptyCamperSatisfaction(12345),
    })
    expect(screen.getByText('S')).toBeInTheDocument()
    expect(screen.queryByText('P')).toBeNull()
  })

  it('Stage 4 (#1142): renders S badge from source_field alone, no source key', () => {
    // After dropping the bunk_requests.source column, fixtures must derive
    // staff/family from source_field via safeSourceFromField — no fallback to
    // a `source` key that no longer exists on the row.
    const ageReq = makeRequest({
      id: 'stage4-staff',
      request_type: 'age_preference',
      source_field: 'bunking_notes',
      // intentionally NO `source` key — column is dropped
      age_preference_target: 'younger',
    })
    renderPanelWith({
      allBunkRequests: [],
      agePreferenceRequests: [ageReq],
      satisfactionData: {},
      camperSatisfaction: emptyCamperSatisfaction(12345),
    })
    expect(screen.getByText('S')).toBeInTheDocument()
    expect(screen.queryByText('P')).toBeNull()
  })

  it('centralized bucket still wins when present (regression guard for #1159)', () => {
    // When per_request entry exists, it must override the source_field fallback.
    // This is the inverse of the fallback — pin that the bucket path remains
    // canonical and source_field is read ONLY when the centralized map has no
    // entry.
    const ageReq = makeRequest({
      id: 'present',
      request_type: 'age_preference',
      source_field: 'bunk_with', // would set P under fallback
      age_preference_target: 'older',
    })
    const camperSatisfaction: CamperSatisfaction = {
      ...emptyCamperSatisfaction(12345),
      per_request: [{ request_id: 'present', bucket: 'staff', satisfied: false }],
    }
    renderPanelWith({
      allBunkRequests: [],
      agePreferenceRequests: [ageReq],
      satisfactionData: {},
      camperSatisfaction,
    })
    // Bucket wins: S badge, not P.
    expect(screen.getByText('S')).toBeInTheDocument()
    expect(screen.queryByText('P')).toBeNull()
  })

  it('does NOT fabricate parent ratio when aggregator legitimately reports 0/0 parent + non-zero staff', () => {
    // Aggregator is healthy: per_request has entries (staff classifications),
    // counted_totals.staff > 0, counted_totals.material_parent = 0/0. A stale or
    // local-only bunk_with row in the rendered list must NOT be re-bucketed by
    // the fallback — that would silently contradict the canonical aggregator.
    // Fallback fires only when the aggregator is genuinely empty/unavailable.
    const ageStaff = makeRequest({
      id: 'staff-1',
      request_type: 'age_preference',
      source_field: 'bunking_notes',
      age_preference_target: 'younger',
    })
    const stalePartial = makeRequest({
      id: 'stale-bunk_with',
      request_type: 'bunk_with',
      source_field: 'bunk_with',
      requestee_id: 99999,
      requestedPersonName: 'Olivia Chen',
    })
    const camperSatisfaction: CamperSatisfaction = {
      ...emptyCamperSatisfaction(12345),
      // Aggregator says: 1 staff request, 0 parent. per_request has the staff entry,
      // does NOT mention the stale parent row (data drift).
      per_request: [{ request_id: 'staff-1', bucket: 'staff', satisfied: false }],
      counted_totals: {
        material_parent: { total: 0, satisfied: 0 },
        staff: { total: 1, satisfied: 0 },
      },
    }
    renderPanelWith({
      allBunkRequests: [stalePartial],
      agePreferenceRequests: [ageStaff],
      satisfactionData: {},
      camperSatisfaction,
    })
    // Aggregator's authoritative answer: NO parent satisfaction line.
    expect(screen.queryByText(/Parent request satisfaction:/i)).toBeNull()
    // Staff slice should still render (1 staff request).
    expect(screen.getByText(/Staff request satisfaction:/i)).toBeInTheDocument()
  })

  it('derives parent ratio from local bunk_request_form rows when counted_totals is empty', () => {
    // Two bunk_request_form parent rows, /api/satisfaction reports 0/0 (unavailable).
    // Pre-1158 the slice ratio was driven from local rows; restore that as a
    // fallback so a backend hiccup doesn't silently hide the 0/N display.
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: SourceField.BUNK_REQUEST_FORM,
        requestedPersonName: 'Liam Garcia',
      }),
      makeRequest({
        id: 'p2',
        request_type: 'bunk_with',
        source_field: SourceField.BUNK_REQUEST_FORM,
        requestedPersonName: 'Olivia Chen',
      }),
    ]
    renderPanelWith({
      allBunkRequests,
      satisfactionData: { p1: { satisfied: true, detail: null } },
      camperSatisfaction: emptyCamperSatisfaction(12345),
    })
    // 1 satisfied (p1), 2 total → "1/2 met" must appear.
    expect(screen.getByText('1/2 met')).toBeInTheDocument()
  })
})

describe('BunkingStatusPanel — #1159 age-pref badges read per_request.bucket', () => {
  it('renders S badge when per_request bucket=staff even though source_field=bunk_with', () => {
    // Mismatched fixture: row's source_field says bunk_with (would set P badge
    // under the old per-row classification) but the centralized aggregator
    // classified it as bucket=staff. Bucket wins → S badge, not P.
    const ageReq = makeRequest({
      id: 'mismatched',
      request_type: 'age_preference',
      source_field: 'bunk_with',
      age_preference_target: 'older',
    })
    const camperSatisfaction: CamperSatisfaction = {
      ...emptyCamperSatisfaction(12345),
      per_request: [{ request_id: 'mismatched', bucket: 'staff', satisfied: false }],
    }
    renderPanelWith({
      allBunkRequests: [],
      agePreferenceRequests: [ageReq],
      satisfactionData: {},
      camperSatisfaction,
    })
    expect(screen.queryByText('P')).toBeNull()
    expect(screen.getByText('S')).toBeInTheDocument()
  })

  it('renders P badge when per_request bucket=material_parent even though source=staff', () => {
    // Inverse fixture: source='staff' (would set S badge under old code) but
    // bucket=material_parent → P badge.
    const ageReq = makeRequest({
      id: 'mismatched-2',
      request_type: 'age_preference',
      source_field: 'bunking_notes',
      age_preference_target: 'younger',
    })
    const camperSatisfaction: CamperSatisfaction = {
      ...emptyCamperSatisfaction(12345),
      per_request: [{ request_id: 'mismatched-2', bucket: 'material_parent', satisfied: false }],
    }
    renderPanelWith({
      allBunkRequests: [],
      agePreferenceRequests: [ageReq],
      satisfactionData: {},
      camperSatisfaction,
    })
    expect(screen.queryByText('S')).toBeNull()
    expect(screen.getByText('P')).toBeInTheDocument()
  })
})

describe('BunkingStatusPanel — Stage 3b.1 R3 row list', () => {
  it('renders Parent rows before Staff sub-divider before Staff rows', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: SourceField.BUNK_REQUEST_FORM,
        ...({
          targetPerson: { first_name: 'Emma', last_name: 'Johnson', cm_id: 100 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
      makeRequest({
        id: 's1',
        request_type: 'not_bunk_with',
        source_field: SourceField.STAFF_NOT_BUNK_WITH,
        ...({
          targetPerson: { first_name: 'Riley', last_name: 'Sam', cm_id: 200 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
    ]
    const satisfactionData = {
      p1: { satisfied: true, detail: null },
      s1: { satisfied: true, detail: null },
    }
    const { container } = renderPanelWith({ allBunkRequests, satisfactionData })

    // Assert using document-order positions of key elements.
    //
    // The combined Parent ↑ │ ⬇ Staff divider is the only element on the
    // panel with the `font-mono` utility on its container <div>. The summary
    // and row text don't use font-mono.
    const allElements = Array.from(container.querySelectorAll('*'))
    const dividerEl = container.querySelector('div.font-mono')
    expect(dividerEl).not.toBeNull()
    expect(dividerEl?.textContent).toMatch(/Parent.*Staff/)
    const dividerIdx = allElements.indexOf(dividerEl as Element)

    // Emma and Riley's names appear in a <Link> (rendered as <a>) or <span>
    // with the full "First Last" string and possibly a nested SVG icon. We
    // find the closest ancestor element that (a) contains the name, and (b)
    // does NOT contain the other name, so we stay within the individual row.
    const emmaEl = allElements.find(
      (el) =>
        el.textContent?.includes('Emma') &&
        !el.textContent?.includes('Riley') &&
        el.tagName !== 'BODY' &&
        el.tagName !== 'HTML'
    )
    const rileyEl = allElements.find(
      (el) =>
        el.textContent?.includes('Riley') &&
        !el.textContent?.includes('Emma') &&
        el.tagName !== 'BODY' &&
        el.tagName !== 'HTML'
    )

    expect(emmaEl).not.toBeNull()
    expect(rileyEl).not.toBeNull()

    const emmaIdx = allElements.indexOf(emmaEl as Element)
    const rileyIdx = allElements.indexOf(rileyEl as Element)

    expect(emmaIdx).toBeGreaterThan(-1)
    expect(emmaIdx).toBeLessThan(dividerIdx)
    expect(dividerIdx).toBeLessThan(rileyIdx)
  })

  it('omits Staff sub-divider when no staff rows exist', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p1',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        ...({
          targetPerson: { first_name: 'Emma', last_name: 'Johnson', cm_id: 100 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
    ]
    const satisfactionData = { p1: { satisfied: true, detail: null } }
    const { container } = renderPanelWith({ allBunkRequests, satisfactionData })
    // The Parent ↑ │ ⬇ Staff divider only renders when both groups exist.
    // With only parent rows present, the font-mono divider container should
    // not be in the DOM.
    expect(container.querySelector('div.font-mono')).toBeNull()
  })

  it('sorts Parent rows alphabetically by requestee first_name', () => {
    const allBunkRequests = [
      makeRequest({
        id: 'p-olivia',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        ...({
          targetPerson: { first_name: 'Olivia', last_name: 'Chen', cm_id: 100 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
      makeRequest({
        id: 'p-emma',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        ...({
          targetPerson: { first_name: 'Emma', last_name: 'Johnson', cm_id: 101 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
      makeRequest({
        id: 'p-liam',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        ...({
          targetPerson: { first_name: 'Liam', last_name: 'Garcia', cm_id: 102 },
        } as unknown as Partial<EnhancedBunkRequest>),
      }),
    ]
    const satisfactionData = Object.fromEntries(
      allBunkRequests.map((r) => [r.id, { satisfied: true, detail: null }])
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
      source_field: SourceField.BUNK_REQUEST_FORM,
      age_preference_target: 'older',
    })
    const allBunkRequests = [ageReq]
    const agePreferenceRequests = [ageReq]
    const satisfactionData = { a1: { satisfied: true, detail: null } }
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
      age_preference_target: 'younger',
    })
    const allBunkRequests = [ageReq]
    const agePreferenceRequests = [ageReq]
    const satisfactionData = { a1: { satisfied: true, detail: null } }
    renderPanelWith({ allBunkRequests, agePreferenceRequests, satisfactionData })
    expect(screen.getByText('S')).toBeInTheDocument()
  })
})

describe('BunkingStatusPanel — session-scoped row list (#1161)', () => {
  it('hides cross-session rows — only session_id matching camper.session_cm_id renders', () => {
    // camper.session_cm_id === 1000001 (from makeCamper)
    const requests: EnhancedBunkRequest[] = [
      makeRequest({
        id: 'req-session-match',
        session_id: 1000001,
        status: 'resolved',
        requestedPersonName: 'Liam Garcia',
      }),
      makeRequest({
        id: 'req-session-other',
        session_id: 1000006,
        status: 'resolved',
        requestedPersonName: 'Samuel Johnson',
      }),
    ]
    renderPanelWith({ allBunkRequests: requests, satisfactionData: {} })

    expect(screen.getByText('Liam Garcia')).toBeTruthy()
    expect(screen.queryByText('Samuel Johnson')).toBeNull()
  })

  it('hides merged rows — merged_into non-empty filters out the row', () => {
    const requests: EnhancedBunkRequest[] = [
      makeRequest({
        id: 'req-non-merged',
        session_id: 1000001,
        status: 'resolved',
        merged_into: '',
        requestedPersonName: 'Liam Garcia',
      }),
      makeRequest({
        id: 'req-merged',
        session_id: 1000001,
        status: 'resolved',
        merged_into: 'req-non-merged',
        requestedPersonName: 'Olivia Chen',
      }),
    ]
    renderPanelWith({ allBunkRequests: requests, satisfactionData: {} })

    expect(screen.getByText('Liam Garcia')).toBeTruthy()
    expect(screen.queryByText('Olivia Chen')).toBeNull()
  })
})

describe('BunkingStatusPanel — getRequestSatisfaction lookup', () => {
  it('passes satisfied/detail from lookup to MetPill rows', () => {
    const requests: EnhancedBunkRequest[] = [
      makeRequest({
        id: 'rq1',
        status: 'resolved',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        requestee_id: 67890,
      }),
      makeRequest({
        id: 'rq2',
        status: 'resolved',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        requestee_id: 67891,
        requestedPersonName: 'Olivia Chen',
      }),
    ]
    renderPanelWith({
      allBunkRequests: requests,
      satisfactionData: {
        rq1: { satisfied: true, detail: 'Same bunk' },
        rq2: { satisfied: false, detail: 'Different bunks' },
      },
    })
    expect(screen.getByText('Met')).toBeInTheDocument()
    expect(screen.getByText('Unmet')).toBeInTheDocument()
  })

  it('renders no pill when lookup returns {satisfied: null}', () => {
    const requests: EnhancedBunkRequest[] = [
      makeRequest({
        id: 'rq1',
        status: 'resolved',
        request_type: 'bunk_with',
        source_field: 'bunk_with',
        requestee_id: 67890,
      }),
    ]
    // Empty satisfactionData → lookup returns {null, null} for every id.
    renderPanelWith({ allBunkRequests: requests, satisfactionData: {} })
    expect(screen.queryByText('Met')).not.toBeInTheDocument()
    expect(screen.queryByText('Unmet')).not.toBeInTheDocument()
  })

  it('renders Unmet with "No grade on file" tooltip for grade-less age preference', () => {
    const ageReq = makeRequest({
      id: 'agepref',
      status: 'resolved',
      request_type: 'age_preference',
      age_preference_target: 'older',
      source_field: 'socialize_with',
    })
    renderPanelWith({
      allBunkRequests: [],
      agePreferenceRequests: [ageReq],
      satisfactionData: {
        agepref: { satisfied: false, detail: 'No grade on file' },
      },
    })
    const pill = screen.getByText('Unmet')
    expect(pill.parentElement).toHaveAttribute('title', 'No grade on file')
  })
})
