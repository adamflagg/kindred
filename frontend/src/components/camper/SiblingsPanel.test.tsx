import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { SiblingWithEnrollment } from '../../hooks/camper/types'
import { SiblingsPanel } from './SiblingsPanel'

vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

const partner = {
  id: 'p2',
  cm_id: 3000002,
  first_name: 'David',
  last_name: 'Johnson',
  gender: 'M',
  grade: 0,
  age: 46.02,
  attendeeStatus: 'enrolled',
  session: { id: 's', cm_id: 1, name: "Men's Weekend", session_type: 'adult' },
  additionalSessions: [],
} as unknown as SiblingWithEnrollment

function renderPanel(props: Partial<Parameters<typeof SiblingsPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SiblingsPanel siblings={[partner]} isLoading={false} error={null} {...props} />
    </MemoryRouter>
  )
}

describe('SiblingsPanel', () => {
  it('can be titled Household', () => {
    renderPanel({ title: 'Household' })
    expect(screen.getByText('Household')).toBeInTheDocument()
  })

  it('shows no grade for someone without one — formatGradeOrdinal(0) would print "0th"', () => {
    renderPanel({ title: 'Household' })
    expect(screen.queryByText(/0th/)).toBeNull()
  })

  // kindred#2779: a sibling's grade reads `grade_name`, bare like the ages.
  it('shows a kindergarten sibling as K', () => {
    renderPanel({ siblings: [{ ...partner, grade: 0, grade_name: 'K', age: 5.06 }] })
    expect(screen.getByText(/• K$/)).toBeInTheDocument()
  })

  it('shows a preschool sibling as Pre-K', () => {
    renderPanel({ siblings: [{ ...partner, grade: -1, grade_name: 'Pre-K', age: 4.02 }] })
    expect(screen.getByText(/• Pre-K$/)).toBeInTheDocument()
  })

  it('shows a sibling past 12th grade as Grad', () => {
    renderPanel({ siblings: [{ ...partner, grade: 13, grade_name: '12th+', age: 18.02 }] })
    expect(screen.getByText(/• Grad$/)).toBeInTheDocument()
  })

  it('shows an ordinal grade bare, without "Grade"', () => {
    renderPanel({ siblings: [{ ...partner, grade: 5, grade_name: '5th', age: 10.04 }] })
    expect(screen.getByText(/• 5th$/)).toBeInTheDocument()
  })

  it('lists additional programs', () => {
    renderPanel({
      siblings: [
        { ...partner, additionalSessions: [{ name: 'Family Camp 1', session_type: 'family' }] },
      ],
    })
    expect(screen.getByText(/Family Camp 1/)).toBeInTheDocument()
  })

  it('defaults to Siblings', () => {
    renderPanel()
    expect(screen.getByText('Siblings')).toBeInTheDocument()
  })

  // Owner ruling 2026-09-22 ("P3"): with every separator the same dot,
  // "Session 3 • 🏠 B-7 • Family Camp 1" left the cabin's owning program
  // ambiguous once more than one program was on the line. A session and its
  // OWN cabin now sit with no separator between them; only a transition to a
  // DIFFERENT program gets a separator, and that separator is a vertical bar.
  describe('line 2 separators ("P3", owner ruling 2026-09-22)', () => {
    it('puts no dot between a session and its own cabin', () => {
      renderPanel({
        siblings: [
          {
            ...partner,
            session: { id: 's4', cm_id: 1, name: 'Session 4', session_type: 'main' },
            bunkName: 'Bunk 12',
            additionalSessions: [],
          },
        ],
      })
      const row = screen.getByText('David Johnson').closest('a')
      if (!row) throw new Error('sibling row anchor not found')
      expect(within(row).getByText('Bunk 12')).toBeInTheDocument()
      expect(within(row).queryByText('•')).not.toBeInTheDocument()
    })

    it('separates two programs with a vertical bar, never a dot', () => {
      renderPanel({
        siblings: [
          {
            ...partner,
            session: { id: 's4', cm_id: 1, name: 'Session 4', session_type: 'main' },
            bunkName: 'Bunk 12',
            additionalSessions: [{ name: 'Family Camp 1', session_type: 'family' }],
          },
        ],
      })
      const row = screen.getByText('David Johnson').closest('a')
      if (!row) throw new Error('sibling row anchor not found')
      expect(within(row).getByText('|')).toBeInTheDocument()
      expect(within(row).queryByText('•')).not.toBeInTheDocument()
    })
  })
})
