/**
 * The write-in ↔ Jotform link in the Push write-ins deck and the Compare modal
 * (kindred#2759 follow-up). Adult weekends draw the bunking-request mark beside
 * a linked write-in's name, and the deck's conflict card diffs the link. Family
 * Camp renders both exactly as before, even when a row carries a link.
 * Fictional names only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PushBuildingReport, PushRowPayload } from '../../services/lodgingApi'
import type { BunkingRequest, ScenarioCompare } from '../../types/lodging'
import { PushDecisionDeck } from './PushDecisionDeck'
import { ScenarioCompareModal } from './ScenarioCompareModal'

const mockFetchWithAuth = vi.fn()
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))
vi.mock('../../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => ({
    data: { lodging_assignments: { status: 'success', end_time: new Date().toISOString() } },
  }),
}))
vi.mock('../../hooks/useWeekendRoster', () => ({
  useWeekendRoster: () => ({ data: { units: [] } }),
}))

const REQUEST: BunkingRequest = {
  state: 'request',
  current_text: 'Emma Johnson',
  versions: [{ submitted_at: '2026-08-31 09:00:00', text: 'Emma Johnson' }],
  changed: false,
  coming_with: [],
  submitted: ['2026-08-31 09:00:00'],
  staff_linked: true,
  jotform_says: [],
}

function row(occupant: string, overrides: Partial<PushRowPayload> = {}): PushRowPayload {
  return {
    unit_id: 'u-cedar-9',
    unit_code: 'cedar-9',
    unit_name: 'Cedar 9',
    occupant_name: occupant,
    note: '',
    party_size: null,
    sleeps: 4,
    ...overrides,
  }
}

/** The same write-in on both sides; only the scenario's copy is linked. */
const LINK_ONLY_CONFLICT: PushBuildingReport = {
  key: 'cedar-9',
  label: 'Cedar 9',
  cls: 'conflict',
  live: [row('Pat Doe')],
  draft: [row('Pat Doe', { write_in_key: 'k1', bunking_request: REQUEST })],
}

const REMOVED_LINKED: PushBuildingReport = {
  key: 'aspen-5',
  label: 'Aspen 5',
  cls: 'remove',
  live: [
    row('Riley Sam', {
      unit_id: 'u-aspen-5',
      unit_code: 'aspen-5',
      unit_name: 'Aspen 5',
      write_in_key: 'k2',
      bunking_request: REQUEST,
    }),
  ],
  draft: [],
}

function deck(buildings: PushBuildingReport[], sessionType: string) {
  return (
    <PushDecisionDeck
      buildings={buildings}
      decisions={{}}
      onDecide={vi.fn()}
      onPush={vi.fn()}
      pushDisabled
      sessionType={sessionType}
    />
  )
}

describe('PushDecisionDeck — Jotform links', () => {
  it('diffs a link that differs as one more field, and marks the linked side', () => {
    render(deck([LINK_ONLY_CONFLICT], 'adult'))
    const live = screen.getByRole('button', { name: 'On CampMinder now' })
    const scenario = screen.getByRole('button', { name: 'This scenario' })
    expect(within(live).getByText('Jotform')).toBeInTheDocument()
    expect(within(scenario).getByText('Jotform')).toBeInTheDocument()
    expect(within(scenario).getByLabelText('Jotform: Has a bunking request')).toBeInTheDocument()
    expect(within(live).queryByLabelText(/^Jotform:/)).not.toBeInTheDocument()
  })

  it('draws no Jotform field when both sides carry the same link', () => {
    const same: PushBuildingReport = {
      ...LINK_ONLY_CONFLICT,
      live: [row('Pat Doe', { note: 'Friday', write_in_key: 'k1', bunking_request: REQUEST })],
    }
    render(deck([same], 'adult'))
    expect(screen.queryByText('Jotform')).not.toBeInTheDocument()
    // Still marked beside the name on both sides.
    expect(screen.getAllByLabelText('Jotform: Has a bunking request')).toHaveLength(2)
  })

  it("marks a linked write-in on the remove card's name", () => {
    render(deck([REMOVED_LINKED], 'adult'))
    expect(screen.getByLabelText('Jotform: Has a bunking request')).toBeInTheDocument()
  })

  it('renders a Family Camp deck exactly as before, even with a link on a row', () => {
    const { container } = render(deck([LINK_ONLY_CONFLICT, REMOVED_LINKED], 'family'))
    const withLink = container.innerHTML
    const plain = (b: PushBuildingReport): PushBuildingReport => ({
      ...b,
      live: b.live.map(({ write_in_key: _k, bunking_request: _r, ...rest }) => rest),
      draft: b.draft.map(({ write_in_key: _k, bunking_request: _r, ...rest }) => rest),
    })
    const { container: before } = render(
      <PushDecisionDeck
        buildings={[plain(LINK_ONLY_CONFLICT), plain(REMOVED_LINKED)]}
        decisions={{}}
        onDecide={vi.fn()}
        onPush={vi.fn()}
        pushDisabled
      />
    )
    expect(withLink).toBe(before.innerHTML)
    expect(screen.queryByText('Jotform')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Jotform:/)).not.toBeInTheDocument()
  })
})

const COMPARE: ScenarioCompare = {
  year: 2026,
  session_cm_id: 1309001,
  scenario: 'scn_1',
  session_name: 'A Weekend',
  counts: { match: 0, both_unassigned: 0, conflict: 0, add: 1, remove: 0 },
  parties: [],
  write_ins: [
    {
      key: 'cedar-9',
      label: 'Cedar 9',
      cls: 'add',
      live: [],
      draft: [
        row('Pat Doe', { write_in_key: 'k1', bunking_request: REQUEST }),
        row('Kitchen crew'),
      ],
    },
  ],
}

function renderCompare(sessionType?: string) {
  mockFetchWithAuth.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(COMPARE),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ScenarioCompareModal
        year={2026}
        sessionCmId={1309001}
        scenario="scn_1"
        isOpen
        onClose={vi.fn()}
        {...(sessionType === undefined ? {} : { sessionType })}
      />
    </QueryClientProvider>
  )
}

describe('ScenarioCompareModal — Jotform links', () => {
  beforeEach(() => {
    mockFetchWithAuth.mockReset()
  })

  it('marks a linked write-in beside its name on an adult weekend', async () => {
    renderCompare('adult')
    const [writeIn] = await screen.findAllByTestId('compare-write-in-row')
    expect(writeIn).toHaveTextContent('Pat Doe · Kitchen crew')
    expect(within(writeIn!).getAllByLabelText('Jotform: Has a bunking request')).toHaveLength(1)
  })

  it('renders a Family Camp write-in row exactly as before', async () => {
    renderCompare('family')
    const [writeIn] = await screen.findAllByTestId('compare-write-in-row')
    expect(writeIn).toHaveTextContent('Pat Doe · Kitchen crew')
    expect(within(writeIn!).queryByLabelText(/^Jotform:/)).not.toBeInTheDocument()
  })
})
