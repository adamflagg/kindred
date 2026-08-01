/**
 * The illegal-merge repair queue.
 *
 * `groupIllegalMerges` (Task 6) dedups the QUEUE, not the party columns, so
 * one broken unit set blocking twelve households is twelve rows on the wire.
 * These tests prove the PANEL collapses them, and that the cut "accept
 * anyway" affordance stays cut.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MergeRepairPanel } from './MergeRepairPanel'
import * as crud from '../../../services/lodgingCrud'
import type {
  LodgingAliasRecord,
  LodgingIngestIssueRecord,
  LodgingUnitRecord,
} from '../../../types/lodging'

function issue(over: Partial<LodgingIngestIssueRecord>): LodgingIngestIssueRecord {
  return {
    id: 'i1',
    kind: 'illegal_merge',
    raw_value: 'Some Building 1and2',
    household_cm_id: 1,
    person_cm_id: 0,
    year: 2026,
    suggested_session: '',
    candidate_session_cm_ids: [],
    is_resolved: false,
    occurrences: 1,
    source_field: 'Family Camp Cabin',
    resolved_alias: '',
    first_seen: '2026-07-31 03:31:18.711Z',
    last_seen: '2026-07-31 10:04:24.058Z',
    resolution_note: '',
    ...over,
  }
}

// Three households blocked on ONE broken set. The queue dedup key is per
// household, so this is what the API really returns — and rendering it as
// three rows is the failure this panel exists to prevent.
const THREE_HOUSEHOLDS = [
  issue({ id: 'a', household_cm_id: 1 }),
  issue({ id: 'b', household_cm_id: 2 }),
  issue({ id: 'c', household_cm_id: 3 }),
]

function unitFixture(
  over: Partial<LodgingUnitRecord> & { id: string; name: string }
): LodgingUnitRecord {
  return {
    area: 'a1',
    code: over.id,
    parent_unit: '',
    map_x: 0,
    map_y: 0,
    sleeps: 4,
    beds: null,
    bathroom: 'none',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    allocation_default: 'family_pool',
    is_confirmed: true,
    is_active: true,
    is_container: false,
    notes: '',
    ...over,
  }
}

let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

// MergeRepairPanel's actions are react-router `Link`s, so this needs a
// Router context — unlike UnresolvedAliasQueue, which has none of its own.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MergeRepairPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(crud, 'listIllegalMergeIssues').mockResolvedValue(THREE_HOUSEHOLDS)
  })

  it('renders one row per member set, not one per party', async () => {
    render(<MergeRepairPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
    })
    expect(screen.getByText(/3 parties/i)).toBeInTheDocument()
  })

  // These rows are ADVISORY: the ingest placed every one of these parties and
  // queued the row so staff can review the grouping. Copy saying "blocked"
  // describes the old gating behaviour and would send staff hunting for
  // families who are not missing a cabin.
  it('says the parties were placed, never that they are blocked', async () => {
    render(<MergeRepairPanel />, { wrapper })
    await screen.findByText(/3 parties/i)
    expect(screen.queryByText(/blocked/i)).toBeNull()
    expect(screen.getByText(/3 parties placed/i)).toBeInTheDocument()
    // And the panel says so once at the top, so the list does not read as an outage.
    expect(screen.getByText(/everyone has been placed/i)).toBeInTheDocument()
  })

  // NOTE: the two "override" tests that used to sit here are DELETED along with
  // the Accept-anyway affordance. Do not restore them — see the cut in
  // task-7-brief.md. What replaces them is a test that the panel offers
  // exactly two actions and NO override control, so the cut cannot silently
  // regress:
  it('offers no override control', async () => {
    render(<MergeRepairPanel />, { wrapper })
    await screen.findByText(/3 parties/i)
    expect(screen.queryByRole('button', { name: /accept anyway/i })).toBeNull()
    expect(screen.getByRole('link', { name: /edit the alias/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit the registry/i })).toBeInTheDocument()
  })

  it('renders an empty state rather than a spinner when the queue is clear', async () => {
    vi.spyOn(crud, 'listIllegalMergeIssues').mockResolvedValue([])
    render(<MergeRepairPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/no merge repairs/i)).toBeInTheDocument()
    })
  })
})

describe('MergeRepairPanel — the verdict', () => {
  // A building with rooms N1 (member), N2 (member) and N3 (the sibling the
  // alias never picked up). This is the shape a partial merge actually takes:
  // JudgeMerge (pocketbase/sync/lodging_merge_rules.go) calls it illegal
  // because N3 is absent from the member set, not because anything else is
  // wrong with N1/N2.
  const NORTH_LODGE = unitFixture({ id: 'building', name: 'North Lodge', is_container: true })
  const N1 = unitFixture({ id: 'n1', name: 'North 1', parent_unit: 'building' })
  const N2 = unitFixture({ id: 'n2', name: 'North 2', parent_unit: 'building' })
  const N3 = unitFixture({ id: 'n3', name: 'North 3', parent_unit: 'building' })

  const ALIAS: LodgingAliasRecord = {
    id: 'alias_1',
    alias_string: 'Some Building 1and2',
    member_units: ['n1', 'n2'],
    valid_from_year: 0,
    valid_to_year: 0,
    source_field: 'Family Camp Cabin',
    notes: '',
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(crud, 'listIllegalMergeIssues').mockResolvedValue(THREE_HOUSEHOLDS)
  })

  it('names the missing sibling and its container once the registry loads', async () => {
    vi.spyOn(crud, 'listLodgingUnits').mockResolvedValue([NORTH_LODGE, N1, N2, N3])
    vi.spyOn(crud, 'listLodgingAliases').mockResolvedValue([ALIAS])

    render(<MergeRepairPanel />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText(/North Lodge/)).toBeInTheDocument()
    })
    expect(screen.getByText(/North 3/)).toBeInTheDocument()
  })

  // pocketbase/sync/lodging_merge_rules.go's PlacementIsLegal never routes a
  // single-unit resolution through JudgeMerge at all — `!res.IsMerge() || ...`
  // short-circuits it legal, because naming one unit is a direct placement,
  // not a merge. JudgeMerge itself would say "needs at least two member
  // units" and return Legal: false, which is right for JudgeMerge's own job
  // but wrong here: a narrowed alias (exactly the repair this panel exists
  // for) lands here, and must never render as "every other room is missing".
  it('treats a narrowed single-unit alias as legal, not as a merge missing every sibling', async () => {
    const SOLO_ALIAS: LodgingAliasRecord = { ...ALIAS, id: 'alias_2', member_units: ['n1'] }
    vi.spyOn(crud, 'listLodgingUnits').mockResolvedValue([NORTH_LODGE, N1, N2, N3])
    vi.spyOn(crud, 'listLodgingAliases').mockResolvedValue([SOLO_ALIAS])

    render(<MergeRepairPanel />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText(/3 parties/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/missing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/North 2/)).not.toBeInTheDocument()
    expect(screen.queryByText(/North 3/)).not.toBeInTheDocument()
  })

  // The trap this guards: coercing a failed secondary query to `[]` computes
  // a member set of nothing, which would print "missing: " with nothing
  // after it — a repair hint that quietly becomes nonsense instead of an
  // honest "could not load".
  it('says the registry failed to load rather than naming nothing as missing', async () => {
    vi.spyOn(crud, 'listLodgingUnits').mockRejectedValue(new Error('network'))
    vi.spyOn(crud, 'listLodgingAliases').mockResolvedValue([ALIAS])

    render(<MergeRepairPanel />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText(/could not load the registry/i)).toBeInTheDocument()
    })
    // The row itself, and both actions, still render — only the verdict text
    // is degraded.
    expect(screen.getByText(/3 parties/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit the registry/i })).toBeInTheDocument()
  })
})
