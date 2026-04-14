import { describe, it, expect } from 'vitest'
import { render, screen } from '../test/testUtils'
import { BunkRequestRow } from './BunkRequestRow'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

function makeRequest(overrides: Partial<BunkRequestsResponse> = {}): BunkRequestsResponse {
  return {
    id: 'req1',
    request_type: 'bunk_with',
    status: 'resolved',
    requester_id: 100,
    session_id: 1001,
    year: 2025,
    source_field: 'friend_request',
    created: '2025-01-01',
    updated: '2025-01-01',
    ...overrides,
  } as unknown as BunkRequestsResponse
}

function makePerson(overrides: Partial<PersonsResponse> = {}): PersonsResponse {
  return {
    id: 'p1',
    cm_id: 200,
    first_name: 'Olivia',
    last_name: 'Chen',
    year: 2025,
    created: '2025-01-01',
    updated: '2025-01-01',
    ...overrides,
  } as unknown as PersonsResponse
}

describe('BunkRequestRow', () => {
  it('renders a resolved status with a green check icon', () => {
    const { container } = render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
      />
    )
    // CheckCircle for resolved - forest-600
    expect(container.querySelector('.text-forest-600')).toBeTruthy()
  })

  it('renders a pending status with an amber clock icon', () => {
    const { container } = render(
      <BunkRequestRow
        request={makeRequest({ status: 'pending', requested_person_name: 'Liam Garcia' })}
      />
    )
    expect(container.querySelector('.text-amber-500')).toBeTruthy()
  })

  it('renders a declined status with a bark X icon', () => {
    const { container } = render(
      <BunkRequestRow
        request={makeRequest({ status: 'declined', requested_person_name: 'Noah Smith' })}
      />
    )
    expect(container.querySelector('.text-bark-600')).toBeTruthy()
  })

  it('renders "Bunk with" label for bunk_with requests', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ request_type: 'bunk_with', requestee_id: 200 })}
        targetPerson={makePerson()}
      />
    )
    expect(screen.getByText('Bunk with')).toBeInTheDocument()
  })

  it('renders "Not bunk with" label in red for not_bunk_with requests', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ request_type: 'not_bunk_with', requestee_id: 200 })}
        targetPerson={makePerson()}
      />
    )
    const label = screen.getByText('Not bunk with')
    expect(label).toBeInTheDocument()
    expect(label.className).toMatch(/text-red-600/)
  })

  it('renders target name via CamperLink when requestee_id set and resolved', () => {
    render(
      <BunkRequestRow
        request={makeRequest({
          status: 'resolved',
          requestee_id: 200,
          requested_person_name: 'Olivia Chen',
        })}
        targetPerson={makePerson({ first_name: 'Olivia', last_name: 'Chen' })}
      />
    )
    // Resolved + requestee_id → CamperLink renders link
    expect(screen.getByText(/Olivia Chen/)).toBeInTheDocument()
  })

  it('renders mutual badge with MUTUAL_BADGE_CLASSES when is_reciprocal is true', () => {
    render(
      <BunkRequestRow
        request={makeRequest({
          status: 'resolved',
          requestee_id: 200,
          is_reciprocal: true,
        })}
        targetPerson={makePerson()}
      />
    )
    const badge = screen.getByText('mutual')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/bg-forest-100/)
  })

  it('does not render mutual badge when is_reciprocal is false', () => {
    render(
      <BunkRequestRow
        request={makeRequest({
          status: 'resolved',
          requestee_id: 200,
          is_reciprocal: false,
        })}
        targetPerson={makePerson()}
      />
    )
    expect(screen.queryByText('mutual')).not.toBeInTheDocument()
  })

  it('renders satisfaction check when showSatisfaction and satisfied', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={true}
        satisfaction="satisfied"
      />
    )
    expect(screen.getByText('✓')).toBeInTheDocument()
  })

  it('renders satisfaction X when showSatisfaction and not_satisfied', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={true}
        satisfaction="not_satisfied"
      />
    )
    expect(screen.getByText('✗')).toBeInTheDocument()
  })

  it('renders satisfaction ? when showSatisfaction and unknown', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={true}
        satisfaction="unknown"
      />
    )
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('does not render satisfaction icons when showSatisfaction is false', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={false}
        satisfaction="satisfied"
      />
    )
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
  })

  it('renders "Prefers bunking with older campers" for age_preference request', () => {
    render(
      <BunkRequestRow
        request={makeRequest({
          request_type: 'age_preference',
          age_preference_target: 'older',
        })}
      />
    )
    expect(screen.getByText(/Prefers bunking with/)).toBeInTheDocument()
    expect(screen.getByText(/older/)).toBeInTheDocument()
  })

  it('renders "Prefers bunking with younger campers" for age_preference request', () => {
    render(
      <BunkRequestRow
        request={makeRequest({
          request_type: 'age_preference',
          age_preference_target: 'younger',
        })}
      />
    )
    expect(screen.getByText(/Prefers bunking with/)).toBeInTheDocument()
    expect(screen.getByText(/younger/)).toBeInTheDocument()
  })

  it('renders Sparkles icon for age preference', () => {
    const { container } = render(
      <BunkRequestRow
        request={makeRequest({
          request_type: 'age_preference',
          age_preference_target: 'older',
        })}
      />
    )
    // Sparkles lucide-react icon has class lucide-sparkles
    expect(container.querySelector('.lucide-sparkles')).toBeTruthy()
  })

  it('adds ring/highlight classes when isCurrent is true', () => {
    const { container } = render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        isCurrent={true}
      />
    )
    const row = container.firstElementChild as HTMLElement
    expect(row.className).toMatch(/ring-primary\/40/)
    expect(row.className).toMatch(/bg-primary\/5/)
    expect(row.className).toMatch(/ring-1/)
  })

  it('does NOT render ring when isCurrent is false or omitted', () => {
    const { container } = render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
      />
    )
    const row = container.firstElementChild as HTMLElement
    expect(row.className).not.toMatch(/ring-primary\/40/)
  })

  it('shows (unresolved) on target name when not confirmed but has a name', () => {
    render(
      <BunkRequestRow
        request={makeRequest({
          status: 'pending',
          requested_person_name: 'Liam Garcia',
        })}
      />
    )
    expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
  })

  it('falls back to "Unknown" when neither person nor name is provided', () => {
    render(<BunkRequestRow request={makeRequest({ status: 'pending' })} />)
    expect(screen.getByText(/Unknown/)).toBeInTheDocument()
  })
})
