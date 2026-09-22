/**
 * useSiblings — the Household (adult) and Siblings (child) rules.
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
const enrolment = (sessionName: string, sessionType: string, startDate = '2026-06-01') => ({
  status: 'enrolled',
  expand: {
    session: {
      id: `s-${sessionName}`,
      cm_id: 1,
      name: sessionName,
      session_type: sessionType,
      start_date: startDate,
    },
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

  it("never shows a family-camp member's day group as a cabin — no bunk lookup for family camp", async () => {
    mockPersons.mockResolvedValue([member(3000002, { grade: 0 })])
    mockAttendees.mockResolvedValue([enrolment('Family Camp 1', 'family')])
    mockAssignments.mockResolvedValue([{ expand: { bunk: { name: 'Day Group B' } } }])
    const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'child'), { wrapper })
    await waitFor(() => expect(result.current.siblings).toHaveLength(1))
    expect(result.current.siblings[0]?.bunkName).toBeNull()
    expect(mockAssignments).not.toHaveBeenCalled()
  })

  it('no bunk lookup when the primary program is an adult program', async () => {
    mockPersons.mockResolvedValue([member(3000002, { grade: 0 })])
    mockAttendees.mockResolvedValue([enrolment("Women's Weekend", 'adult')])
    mockAssignments.mockResolvedValue([{ expand: { bunk: { name: 'Day Group B' } } }])
    const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'adult'), { wrapper })
    await waitFor(() => expect(result.current.siblings).toHaveLength(1))
    expect(result.current.siblings[0]?.bunkName).toBeNull()
    expect(mockAssignments).not.toHaveBeenCalled()
  })

  it('still looks up the cabin for a summer primary program', async () => {
    mockPersons.mockResolvedValue([member(3000002, { grade: 4 })])
    mockAttendees.mockResolvedValue([enrolment('Session 2', 'main')])
    mockAssignments.mockResolvedValue([{ expand: { bunk: { name: 'B-3' } } }])
    const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'child'), { wrapper })
    await waitFor(() => expect(result.current.siblings).toHaveLength(1))
    expect(result.current.siblings[0]?.bunkName).toBe('B-3')
  })

  describe('primary program among non-summer types is deterministic', () => {
    const rows = () => [
      enrolment('TLI', 'tli', '2026-07-10'),
      enrolment('Family Camp 2', 'family', '2026-08-20'),
      enrolment('Family Camp 1', 'family', '2026-05-15'),
    ]
    it.each([
      ['as returned', (r: ReturnType<typeof rows>) => r],
      ['reversed', (r: ReturnType<typeof rows>) => [...r].reverse()],
      ['rotated', (r: ReturnType<typeof rows>) => [...r.slice(1), ...r.slice(0, 1)]],
    ])('earliest start date wins (%s)', async (_label, order) => {
      mockPersons.mockResolvedValue([member(3000002, { grade: 0 })])
      mockAttendees.mockResolvedValue(order(rows()))
      const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'child'), { wrapper })
      await waitFor(() => expect(result.current.siblings).toHaveLength(1))
      expect(result.current.siblings[0]?.session?.name).toBe('Family Camp 1')
      expect(result.current.siblings[0]?.additionalSessions?.map((s) => s.name)).toEqual([
        'TLI',
        'Family Camp 2',
      ])
    })

    it.each([
      ['as returned', false],
      ['reversed', true],
    ])('same start date breaks by name (%s)', async (_label, reverse) => {
      const same = [
        enrolment('Family Camp B', 'family', '2026-05-15'),
        enrolment('Family Camp A', 'family', '2026-05-15'),
      ]
      mockPersons.mockResolvedValue([member(3000002, { grade: 0 })])
      mockAttendees.mockResolvedValue(reverse ? [...same].reverse() : same)
      const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'child'), { wrapper })
      await waitFor(() => expect(result.current.siblings).toHaveLength(1))
      expect(result.current.siblings[0]?.session?.name).toBe('Family Camp A')
    })

    it('a summer program still outranks an earlier non-summer one', async () => {
      mockPersons.mockResolvedValue([member(3000002, { grade: 4 })])
      mockAttendees.mockResolvedValue([
        enrolment('Family Camp 1', 'family', '2026-05-15'),
        enrolment('Session 3', 'main', '2026-07-20'),
      ])
      const { result } = renderHook(() => useSiblings(555, 3000001, 2026, 'child'), { wrapper })
      await waitFor(() => expect(result.current.siblings).toHaveLength(1))
      expect(result.current.siblings[0]?.session?.name).toBe('Session 3')
    })
  })
})
