/**
 * AG bunk numbers are cabin LOCATIONS, not grades (#1800 made this
 * authoritative on the Go sync side; this is its frontend twin).
 *
 * Before the fix, BunkCard parsed the trailing number in an AG bunk's name
 * (e.g. "AG-6") as a grade and required it to fall inside the AG session's
 * grade range. Session 2's AG session is "7th & 8th grades" but its cabin is
 * AG-6, so the drop target was disabled and dnd-kit silently refused the
 * drop. Sessions 3 and 4 only "worked" by coincidence (AG-10 sits in
 * 9th-10th, AG-4 in 4th-6th).
 *
 * This test renders the real BunkCard and inspects the `disabled` flag
 * BunkCard passes to `useDroppable` — the same technique BunkCard.dnd.test.tsx
 * uses for prod-mode gating.
 *
 * Fictional camper/session data throughout.
 */
import { render } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BunkWithCampers, Camper } from '../types/app-types'
import type { CampSessionsResponse } from '../types/pocketbase-types'

const useDroppableMock = vi.fn((_args: unknown) => ({ setNodeRef: () => {}, isOver: false }))

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    useDroppable: (args: unknown) => useDroppableMock(args),
  }
})

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable')
  return {
    ...actual,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
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

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

import BunkCard from './BunkCard'

const AG_SESSION_2 = {
  cm_id: 1378704,
  parent_id: 1235404,
  session_type: 'ag',
  name: 'All-Gender Cabin-Session 2 (7th & 8th grades)',
} as unknown as CampSessionsResponse

// 9th & 10th grades — pairs with AG-10 the way Session 3 actually does, so
// the "grade range happened to overlap before" case below is a real overlap
// under the old (deleted) rule, not just a different combination that also
// happens to pass under the new one.
const AG_SESSION_3 = {
  cm_id: 1344559,
  parent_id: 1235405,
  session_type: 'ag',
  name: 'All-Gender Cabin-Session 3 (9th & 10th grades)',
} as unknown as CampSessionsResponse

const NON_AG_SESSION = {
  cm_id: 1235404,
  parent_id: 0,
  session_type: 'main',
  name: 'Session 2',
} as unknown as CampSessionsResponse

const agCamper = (name: string, gender: 'M' | 'F' | 'NB' = 'M', session = AG_SESSION_2) =>
  ({
    id: `${name}:${session.cm_id}`,
    name,
    age: 13,
    grade: 7,
    gender,
    session_cm_id: session.cm_id,
    person_cm_id: name.length,
    created: '',
    updated: '',
    expand: { session },
  }) as unknown as Camper

const nonAgMaleCamper = (name: string) =>
  ({
    id: `${name}:1235404`,
    name,
    age: 13,
    grade: 7,
    gender: 'M',
    session_cm_id: 1235404,
    person_cm_id: name.length,
    created: '',
    updated: '',
    expand: { session: NON_AG_SESSION },
  }) as unknown as Camper

const nonAgFemaleCamper = (name: string) =>
  ({
    id: `${name}:1235404`,
    name,
    age: 13,
    grade: 7,
    gender: 'F',
    session_cm_id: 1235404,
    person_cm_id: name.length,
    created: '',
    updated: '',
    expand: { session: NON_AG_SESSION },
  }) as unknown as Camper

const makeBunk = (overrides: Partial<BunkWithCampers>) =>
  ({
    id: 'bunk-id',
    cm_id: 1,
    campers: [],
    occupancy: 0,
    utilization: 0,
    ...overrides,
  }) as unknown as BunkWithCampers

const ag6Bunk = makeBunk({ id: 'bunk-ag6', name: 'AG-6', gender: 'Mixed' })
const ag10Bunk = makeBunk({ id: 'bunk-ag10', name: 'AG-10', gender: 'Mixed' })
const boysBunk = makeBunk({ id: 'bunk-b1', name: 'B-1', gender: 'M' })
const girlsBunk = makeBunk({ id: 'bunk-g1', name: 'G-1', gender: 'F' })
const unlabeledBoysBunk = makeBunk({ id: 'bunk-b2', name: 'B-2', gender: '' })
const unlabeledGirlsBunk = makeBunk({ id: 'bunk-g2', name: 'G-2', gender: '' })

describe('BunkCard AG drop eligibility — cabin number is a location, not a grade', () => {
  beforeEach(() => useDroppableMock.mockClear())

  it('enables the drop target for AG-6 when the AG session is 7th & 8th grades', () => {
    render(
      <BunkCard
        bunk={ag6Bunk}
        defaultCapacity={12}
        isProductionMode={false}
        activeDragCamper={agCamper('Riley Sam')}
      />
    )
    expect(useDroppableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bunk-bunk-ag6', disabled: false })
    )
  })

  it('still enables the drop target for AG-10 (grade range happened to overlap before)', () => {
    render(
      <BunkCard
        bunk={ag10Bunk}
        defaultCapacity={12}
        isProductionMode={false}
        activeDragCamper={agCamper('Jordan Lee', 'M', AG_SESSION_3)}
      />
    )
    expect(useDroppableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bunk-bunk-ag10', disabled: false })
    )
  })

  it('still disables an AG camper dropping on a gendered (non-mixed) bunk', () => {
    render(
      <BunkCard
        bunk={boysBunk}
        defaultCapacity={12}
        isProductionMode={false}
        activeDragCamper={agCamper('Casey Kim')}
      />
    )
    expect(useDroppableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bunk-bunk-b1', disabled: true })
    )
  })

  describe('non-AG eligibility rules are unchanged', () => {
    it('enables a male camper dropping on a boys bunk', () => {
      render(
        <BunkCard
          bunk={boysBunk}
          defaultCapacity={12}
          isProductionMode={false}
          activeDragCamper={nonAgMaleCamper('Noah Williams')}
        />
      )
      expect(useDroppableMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bunk-bunk-b1', disabled: false })
      )
    })

    it('disables a male camper dropping on a girls bunk', () => {
      render(
        <BunkCard
          bunk={girlsBunk}
          defaultCapacity={12}
          isProductionMode={false}
          activeDragCamper={nonAgMaleCamper('Noah Williams')}
        />
      )
      expect(useDroppableMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bunk-bunk-g1', disabled: true })
      )
    })

    it('enables a female camper dropping on a girls bunk', () => {
      render(
        <BunkCard
          bunk={girlsBunk}
          defaultCapacity={12}
          isProductionMode={false}
          activeDragCamper={nonAgFemaleCamper('Olivia Chen')}
        />
      )
      expect(useDroppableMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bunk-bunk-g1', disabled: false })
      )
    })

    it('falls back to the B- name prefix when a bunk has no gender label', () => {
      render(
        <BunkCard
          bunk={unlabeledBoysBunk}
          defaultCapacity={12}
          isProductionMode={false}
          activeDragCamper={nonAgMaleCamper('Noah Williams')}
        />
      )
      expect(useDroppableMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bunk-bunk-b2', disabled: false })
      )
    })

    it('falls back to the G- name prefix when a bunk has no gender label', () => {
      render(
        <BunkCard
          bunk={unlabeledGirlsBunk}
          defaultCapacity={12}
          isProductionMode={false}
          activeDragCamper={nonAgFemaleCamper('Olivia Chen')}
        />
      )
      expect(useDroppableMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bunk-bunk-g2', disabled: false })
      )
    })
  })
})
