/**
 * BunkCard's age range, camper order and over-24-months warning all read the
 * DISPLAY age (owner ruling 2026-09-24, utils/displayAge.ts) — never the
 * stored `persons.age` snapshot, which drifts with each row's sync date. A card
 * that sorted and warned by the snapshot while printing the computed age could
 * name a camper "youngest" who is not, and warn against a range it does not
 * show.
 *
 * Fictional campers and dates throughout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { BunkWithCampers, Camper } from '../types/app-types'
import type { CampSessionsResponse } from '../types/pocketbase-types'

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    useDroppable: (_args: unknown) => ({ setNodeRef: () => {}, isOver: false }),
  }
})

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable')
  return {
    ...actual,
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    getCamperLockState: () => 'none',
    getCamperLockGroupColor: () => undefined,
    isDraftMode: false,
  }),
}))

vi.mock('../hooks', () => ({
  useBunkRequestsFromContext: () => ({ data: {} }),
}))

// The card's own rendering is not under test — only the order it is given.
vi.mock('./CamperCard', () => ({
  default: ({ camper }: { camper: Camper }) => <div data-testid="camper-card">{camper.name}</div>,
}))

// A past-year board: the board year is 2025, today is in 2026.
vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2025 }))

import BunkCard from './BunkCard'

const SESSION = { start_date: '2025-07-06 07:00:00.000Z' } as CampSessionsResponse

const camper = (name: string, age: number, birthdate: string) =>
  ({
    id: `${name}:1`,
    name,
    age,
    birthdate,
    grade: 6,
    gender: 'F',
    session_cm_id: 1,
    person_cm_id: name.length,
    created: '',
    updated: '',
    expand: { session: SESSION },
  }) as unknown as Camper

// Stored snapshots rank them Emma < Olivia < Riley, 2.00 apart (no warning).
// At the 2025-07-06 session start they rank Riley < Olivia < Emma:
// Riley 11.04, Olivia 12.01, Emma 13.05 — 2 years 1 month apart (warning).
const CAMPERS = [
  camper('Riley Sam', 12.0, '2014-02-10'),
  camper('Emma Johnson', 10.0, '2012-01-10'),
  camper('Olivia Chen', 11.0, '2013-05-10'),
]

const bunk = {
  id: 'bunk-pb-1000001',
  cm_id: 1000001,
  name: 'G-1',
  gender: 'F',
  campers: CAMPERS,
  occupancy: 3,
  utilization: 25,
} as unknown as BunkWithCampers

describe('BunkCard ages on a past-year board', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 24, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the range from youngest to oldest by display age, and warns on it', () => {
    render(<BunkCard bunk={bunk} defaultCapacity={12} />)
    const range = screen.getByText(/^Ages:/)
    expect(range.textContent).toBe('Ages: 11.04 - 13.05 ⚠️')
  })

  it('lists campers youngest first by display age', () => {
    render(<BunkCard bunk={bunk} defaultCapacity={12} />)
    expect(screen.getAllByTestId('camper-card').map((el) => el.textContent)).toEqual([
      'Riley Sam',
      'Olivia Chen',
      'Emma Johnson',
    ])
  })

  it('sorts by display age while dragging too', () => {
    render(<BunkCard bunk={bunk} defaultCapacity={12} isDragging />)
    expect(screen.getAllByTestId('camper-card').map((el) => el.textContent)).toEqual([
      'Riley Sam',
      'Olivia Chen',
      'Emma Johnson',
    ])
  })
})
