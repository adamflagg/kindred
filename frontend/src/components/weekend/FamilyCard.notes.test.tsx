/**
 * Board notes on the family card. The pixel test is written and its snapshot
 * recorded BEFORE FamilyCard gains the slot prop, so "a card without slots is
 * byte-identical to main" is measured, not asserted. Never run with -u.
 * Fictional data throughout.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { FamilyCard } from './FamilyCard'

// ONE stable drag result for every render: fresh `attributes`/`listeners`
// objects per call would defeat FamilyCardInner's memo in the render-count
// test below. The snapshot is recorded under this same mock, so before and
// after are compared like for like.
const dragStart = vi.hoisted(() => vi.fn())
const DRAG = vi.hoisted(() => ({
  attributes: {},
  listeners: { onPointerDown: (...a: unknown[]) => dragStart(...a) },
  setNodeRef: () => undefined,
  isDragging: false,
}))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
    useDraggable: () => DRAG,
  }
})

// Counts BODY renders, as FamilyCard.test.tsx:44-56 does: resolveNeedGlyphs
// runs once per FamilyCardChips render, i.e. once per memo'd body render.
const bodyRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('./needGlyphs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./needGlyphs')>()
  return {
    ...actual,
    resolveNeedGlyphs: (...args: Parameters<typeof actual.resolveNeedGlyphs>) => {
      bodyRenders.count += 1
      return actual.resolveNeedGlyphs(...args)
    },
  }
})

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    permissions: [],
    isAdmin: false,
    hasPermission: () => false,
    hasAnyPermission: () => false,
  }),
}))

/** React's generated ids depend on render order; the snapshot must not. */
function normalizeIds(html: string): string {
  return html.replace(/[«:_]r[0-9a-z]+[»:_]/g, 'ID')
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 2000001,
    person_cm_id: 0,
    display_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 1000101, display_name: 'Samuel Johnson', age: 8, grade: 3 }],
    party_size: 2,
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

/** One party object for every render, so a re-render changes no prop by accident. */
const PARTY = party()

describe('FamilyCard — pixel identity without note slots', () => {
  it('renders exactly what main renders', () => {
    const { container } = render(<FamilyCard party={PARTY} isDraggable onOpen={vi.fn()} />)
    expect(normalizeIds(container.innerHTML)).toMatchSnapshot()
  })
})
