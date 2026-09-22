/**
 * useSiblings — the Household (adult) and Siblings (child) rules, spec §6.4.
 * Owner rulings 2026-09-22: enrolled only; adults see every household member,
 * adults included; children never see a parent; no grade filter.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSiblings } from './useSiblings'

const mockPersons = vi.fn()
const mockAttendees = vi.fn()
const mockAssignments = vi.fn()
vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn((name: string) => {
      if (name === 'persons') return { getFullList: mockPersons }
      if (name === 'attendees') return { getFullList: mockAttendees }
      if (name === 'bunk_assignments') return { getFullList: mockAssignments }
      throw new Error(`Unexpected collection: ${name}`)
    }),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const member = (cmId: number, extra: Record<string, unknown> = {}) => ({
  id: `p${String(cmId)}`,
  cm_id: cmId,
  first_name: 'Sam',
  last_name: 'Johnson',
  grade: 0,
  ...extra,
})
const enrolment = (sessionName: string, sessionType: string) => ({
  status: 'enrolled',
  expand: {
    session: { id: `s-${sessionName}`, cm_id: 1, name: sessionName, session_type: sessionType },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  mockAssignments.mockResolvedValue([])
})

describe('useSiblings', () => {
  it('reads every household member — no grade filter (it hid 236 family-camp preschoolers)', async () => {
    mockPersons.mockResolvedValue([])
    renderHook(() => useSiblings(555, 3000001, 2026), { wrapper })
    await waitFor(() => expect(mockPersons).toHaveBeenCalled())
    const filter = String(mockPersons.mock.calls[0]?.[0]?.filter ?? '')
    expect(filter).toContain('household_id = 555')
    expect(filter).not.toContain('grade')
  })

  it("a child's enrollment check is kid programs only, enrolled only", async () => {
    mockPersons.mockResolvedValue([member(3000002, { grade: 0 })])
    mockAttendees.mockResolvedValue([enrolment('Family Camp 1', 'family')])
    const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'child'), { wrapper })
    await waitFor(() => expect(result.current.siblings).toHaveLength(1))
    const filter = String(mockAttendees.mock.calls[0]?.[0]?.filter ?? '')
    expect(filter).toContain('status_id = 2')
    expect(filter).toContain('session.session_type = "family"')
    expect(filter).toContain('session.session_type = "tli"')
    expect(filter).not.toContain('"adult"')
  })

  it("an adult's enrollment check includes adult programs", async () => {
    mockPersons.mockResolvedValue([member(3000002, { grade: 0 })])
    mockAttendees.mockResolvedValue([enrolment("Men's Weekend", 'adult')])
    const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'adult'), { wrapper })
    await waitFor(() => expect(result.current.siblings).toHaveLength(1))
    expect(String(mockAttendees.mock.calls[0]?.[0]?.filter ?? '')).toContain(
      'session.session_type = "adult"'
    )
  })

  it('drops a member with no qualifying enrollment', async () => {
    mockPersons.mockResolvedValue([member(3000002)])
    mockAttendees.mockResolvedValue([])
    const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'child'), { wrapper })
    await waitFor(() => expect(mockAttendees).toHaveBeenCalled())
    expect(result.current.siblings).toEqual([])
  })

  it('lists every program a member is in', async () => {
    mockPersons.mockResolvedValue([member(3000002, { grade: 4 })])
    mockAttendees.mockResolvedValue([
      enrolment('Session 2a', 'embedded'),
      enrolment('Family Camp 1', 'family'),
    ])
    const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'child'), { wrapper })
    await waitFor(() => expect(result.current.siblings).toHaveLength(1))
    expect(result.current.siblings[0]?.additionalSessions).toHaveLength(1)
  })
})
