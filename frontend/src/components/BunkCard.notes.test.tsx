/**
 * Board notes on the summer bunk card: BunkCard hands each camper's slots
 * through to its CamperCard. Fictional data throughout.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Camper } from '../types/app-types'

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

vi.mock('./CamperCard', () => ({
  default: ({
    camper,
    noteSlots,
  }: {
    camper: Camper
    noteSlots?: { corner?: React.ReactNode }
  }) => (
    <div data-testid={`camper-${String(camper.person_cm_id)}`}>
      {camper.name}
      {noteSlots?.corner}
    </div>
  ),
}))

// A past-year board: the board year is 2025, today is in 2026.
vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2025 }))

import BunkCard from './BunkCard'
import type { BunkWithCampers } from '../types/app-types'

const camper = (name: string, personCmId: number, sessionCmId: number) =>
  ({
    id: `${String(personCmId)}:1`,
    name,
    person_cm_id: personCmId,
    session_cm_id: sessionCmId,
    grade: 6,
    gender: 'F',
  }) as unknown as Camper

const bunk = {
  id: 'bunk-pb-1',
  cm_id: 1000901,
  name: 'G-1',
  gender: 'F',
  campers: [camper('Emma Johnson', 1000101, 1000001), camper('Olivia Chen', 1000102, 1000002)],
  occupancy: 2,
  utilization: 17,
} as unknown as BunkWithCampers

describe('BunkCard — board note slots pass through', () => {
  it('asks for each camper’s slots and hands them to that camper’s card', () => {
    const camperNoteSlots = vi.fn((c: Camper) => ({
      corner: <span data-testid={`corner-${String(c.person_cm_id)}`} />,
    }))
    render(<BunkCard bunk={bunk} defaultCapacity={12} camperNoteSlots={camperNoteSlots} />)
    expect(screen.getByTestId('camper-1000101')).toContainElement(
      screen.getByTestId('corner-1000101')
    )
    expect(screen.getByTestId('camper-1000102')).toContainElement(
      screen.getByTestId('corner-1000102')
    )
  })
})
