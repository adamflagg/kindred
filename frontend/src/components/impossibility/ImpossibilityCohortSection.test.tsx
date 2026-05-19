import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { ImpossibilityCohortSection } from './ImpossibilityCohortSection'
import { FRIENDLY_REASON_LABELS } from './reasonHints'

describe('ImpossibilityCohortSection', () => {
  it('renders nothing when the cohort is empty', () => {
    const { container } = render(
      <ImpossibilityCohortSection
        campers={[]}
        totalImpossibleRequests={0}
        onSelectCamper={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders friendly reason labels (not raw snake_case)', () => {
    render(
      <ImpossibilityCohortSection
        campers={[
          {
            cm_id: 1,
            name: 'Emma Johnson',
            grade: 5,
            gender: 'F',
            reason_codes: ['grade_compatibility'],
            session_cm_id: 1000001,
          },
        ]}
        totalImpossibleRequests={1}
        onSelectCamper={() => {}}
      />
    )
    expect(screen.getByText(FRIENDLY_REASON_LABELS.grade_compatibility)).toBeInTheDocument()
    expect(screen.queryByText('grade_compatibility')).not.toBeInTheDocument()
  })

  it('calls onSelectCamper with the stringified cm_id', () => {
    const onSelect = vi.fn()
    render(
      <ImpossibilityCohortSection
        campers={[
          {
            cm_id: 7,
            name: 'Liam Garcia',
            grade: 4,
            gender: 'M',
            reason_codes: ['cross_session'],
            session_cm_id: 1000001,
          },
        ]}
        totalImpossibleRequests={1}
        onSelectCamper={onSelect}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Liam Garcia/ }))
    expect(onSelect).toHaveBeenCalledWith('7')
  })

  it('uses singular/plural copy correctly for camper and request counts', () => {
    render(
      <ImpossibilityCohortSection
        campers={[
          {
            cm_id: 1,
            name: 'Emma Johnson',
            grade: 5,
            gender: 'F',
            reason_codes: ['malformed'],
            session_cm_id: 1000001,
          },
        ]}
        totalImpossibleRequests={1}
        onSelectCamper={() => {}}
      />
    )
    expect(screen.getByText(/1 camper won.t get any parent request fulfilled/i)).toBeInTheDocument()
    expect(screen.getByText(/1 impossible request total/i)).toBeInTheDocument()
  })
})
