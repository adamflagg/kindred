import { render, screen } from '@testing-library/react'
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
})
