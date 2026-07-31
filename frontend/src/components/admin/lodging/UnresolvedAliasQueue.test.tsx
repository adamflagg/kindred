/** Unresolved cabin names are a work queue, never a silent drop (spec §3.8). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mapUnresolvedAlias = vi.fn()
const ignoreIngestIssue = vi.fn()
const listUnresolvedAliasIssues = vi.fn()

vi.mock('../../../services/lodgingCrud', () => ({
  listUnresolvedAliasIssues: () => listUnresolvedAliasIssues(),
  listLodgingUnits: () =>
    Promise.resolve([
      {
        id: 'u1',
        area: 'a1',
        name: 'North 1',
        code: 'north-1',
        parent_unit: '',
        map_x: 0,
        map_y: 0,
        sleeps: 4,
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
      },
    ]),
  mapUnresolvedAlias: (...args: unknown[]) => mapUnresolvedAlias(...args),
  ignoreIngestIssue: (...args: unknown[]) => ignoreIngestIssue(...args),
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

import { UnresolvedAliasQueue } from './UnresolvedAliasQueue'

const QUEUE_ROW = {
  id: 'q1',
  kind: 'unresolved_alias' as const,
  raw_value: 'North Lodge - 1and2',
  source_field: 'Family Camp Cabin',
  year: 2026,
  household_cm_id: 0,
  person_cm_id: 0,
  suggested_session: '',
  candidate_session_cm_ids: [],
  occurrences: 4,
  resolved_alias: '',
  first_seen: '2026-07-31 03:31:18.711Z',
  last_seen: '2026-07-31 10:04:24.058Z',
  is_resolved: false,
  resolution_note: '',
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mapUnresolvedAlias.mockReset()
  ignoreIngestIssue.mockReset().mockResolvedValue({})
  listUnresolvedAliasIssues.mockReset().mockResolvedValue([QUEUE_ROW])
})

describe('UnresolvedAliasQueue', () => {
  it('shows the verbatim string, its source field and how often it was seen', async () => {
    render(<UnresolvedAliasQueue />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('North Lodge - 1and2')).toBeInTheDocument()
    })
    expect(screen.getByText('Family Camp Cabin')).toBeInTheDocument()
    // `year` is the camp year. first_seen/last_seen are ingest-RUN timestamps,
    // not a year window, so they must never be rendered as one.
    expect(screen.getByText('Seen 4× · 2026')).toBeInTheDocument()
  })

  it('maps the string to the chosen unit in one click', async () => {
    mapUnresolvedAlias.mockResolvedValue({ id: 'alias_1' })
    const user = userEvent.setup()

    render(<UnresolvedAliasQueue />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('North Lodge - 1and2')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('checkbox', { name: 'North 1' }))
    await user.click(screen.getByRole('button', { name: 'Map to selected units' }))

    await waitFor(() => {
      expect(mapUnresolvedAlias).toHaveBeenCalledTimes(1)
    })
    const [queueId, aliasString, unitIds, options] = mapUnresolvedAlias.mock.calls[0] as [
      string,
      string,
      string[],
      { validFromYear?: number; sourceField?: string },
    ]
    expect(queueId).toBe('q1')
    expect(aliasString).toBe('North Lodge - 1and2')
    expect(unitIds).toEqual(['u1'])
    expect(options.validFromYear).toBe(2026)
    expect(options.sourceField).toBe('Family Camp Cabin')
  })

  it('will not map with nothing selected', async () => {
    const user = userEvent.setup()
    render(<UnresolvedAliasQueue />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('North Lodge - 1and2')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Map to selected units' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Not a cabin' }))
    await waitFor(() => {
      expect(ignoreIngestIssue).toHaveBeenCalledTimes(1)
    })
    const [queueId, note] = ignoreIngestIssue.mock.calls[0] as [string, string]
    expect(queueId).toBe('q1')
    // Resolving without an alias is what distinguishes ignored from mapped, so
    // the note is the only record of why — it must not be empty.
    expect(note).not.toBe('')
  })

  it('says the queue is empty without implying the whole ingest is clean', async () => {
    listUnresolvedAliasIssues.mockResolvedValue([])
    render(<UnresolvedAliasQueue />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/no unresolved cabin names/i)).toBeInTheDocument()
    })
  })
})
