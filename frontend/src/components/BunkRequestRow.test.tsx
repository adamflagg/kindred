import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '../test/testUtils'
import userEvent from '@testing-library/user-event'
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
  it('renders a green dot for bunk_with rows', () => {
    const { container } = render(
      <BunkRequestRow
        request={makeRequest({ request_type: 'bunk_with', requestee_id: 200 })}
        targetPerson={makePerson()}
      />
    )
    // Type-keyed dot — green for bunk_with regardless of status
    expect(container.querySelector('.bg-green-500')).toBeTruthy()
  })

  it('shows "Unknown" when there is no target person and the stored name is empty', () => {
    // PocketBase zero-values scalars rather than omitting them, so an absent
    // `requested_person_name` arrives as '' and not undefined. The row used
    // `?? 'Unknown'`, which never fires on '' -- it rendered a blank name.
    // Measured on the prod snapshot: 0 bunk_with/not_bunk_with rows are empty
    // today (all 1191 empties are age_preference, which returns early above
    // this line), so this is hardening rather than a live defect -- same
    // verdict as #2692. #2669.
    render(
      <BunkRequestRow
        request={makeRequest({ request_type: 'bunk_with', requested_person_name: '' })}
      />
    )
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('renders a red dot for not_bunk_with rows', () => {
    const { container } = render(
      <BunkRequestRow
        request={makeRequest({ request_type: 'not_bunk_with', requestee_id: 200 })}
        targetPerson={makePerson()}
      />
    )
    expect(container.querySelector('.bg-red-500')).toBeTruthy()
  })

  it('renders "Bunk with" label in green for bunk_with requests', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ request_type: 'bunk_with', requestee_id: 200 })}
        targetPerson={makePerson()}
      />
    )
    const label = screen.getByText('Bunk with')
    expect(label).toBeInTheDocument()
    expect(label.className).toMatch(/text-green-700/)
  })

  it('renders "Not with" label in red for not_bunk_with requests', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ request_type: 'not_bunk_with', requestee_id: 200 })}
        targetPerson={makePerson()}
      />
    )
    const label = screen.getByText('Not with')
    expect(label).toBeInTheDocument()
    expect(label.className).toMatch(/text-red-700/)
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

  it('renders "Met" pill when showSatisfaction and satisfied=true', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={true}
        satisfied={true}
      />
    )
    expect(screen.getByText('Met')).toBeInTheDocument()
  })

  it('renders red "Unmet" pill when showSatisfaction and satisfied=false', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={true}
        satisfied={false}
      />
    )
    const pill = screen.getByText('Unmet')
    expect(pill).toBeInTheDocument()
    expect(pill.className).toMatch(/bg-red-100/)
    expect(pill.className).toMatch(/text-red-700/)
  })

  it('renders nothing on the right when showSatisfaction and satisfied=null', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={true}
        satisfied={null}
      />
    )
    expect(screen.queryByText('Met')).not.toBeInTheDocument()
    expect(screen.queryByText('Unmet')).not.toBeInTheDocument()
  })

  it('does not render Met/Unmet pill when showSatisfaction is false', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={false}
        satisfied={true}
      />
    )
    expect(screen.queryByText('Met')).not.toBeInTheDocument()
    expect(screen.queryByText('Unmet')).not.toBeInTheDocument()
  })

  it('renders detail string in tooltip on Met pill', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={true}
        satisfied={true}
        detail="Same bunk"
      />
    )
    const pill = screen.getByText('Met')
    expect(pill.parentElement).toHaveAttribute('title', 'Same bunk')
  })

  it('renders detail string in tooltip on Unmet pill', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ status: 'resolved', requestee_id: 200 })}
        targetPerson={makePerson()}
        showSatisfaction={true}
        satisfied={false}
        detail="Different bunks"
      />
    )
    const pill = screen.getByText('Unmet')
    expect(pill.parentElement).toHaveAttribute('title', 'Different bunks')
  })

  it('renders Unmet with "No grade on file" tooltip for grade-less age preference', () => {
    render(
      <BunkRequestRow
        request={makeRequest({
          request_type: 'age_preference',
          age_preference_target: 'older',
        })}
        showSatisfaction={true}
        satisfied={false}
        detail="No grade on file"
      />
    )
    const pill = screen.getByText('Unmet')
    expect(pill.parentElement).toHaveAttribute('title', 'No grade on file')
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

  it('renders as a <button> row when onSelect is provided and fires on click', async () => {
    const onSelect = vi.fn()
    render(
      <BunkRequestRow
        request={makeRequest({ id: 'req-a', requestee_id: 200 })}
        targetPerson={makePerson()}
        onSelect={onSelect}
      />
    )

    const row = screen.getByRole('button', { name: /bunk with.*olivia chen/i })
    await userEvent.click(row)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not render as a <button> when onSelect is omitted', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ id: 'req-a', requestee_id: 200 })}
        targetPerson={makePerson()}
      />
    )
    expect(screen.queryByRole('button', { name: /bunk with.*olivia chen/i })).toBeNull()
  })

  it('does NOT nest the row in a native <button> when onSelect is provided', () => {
    // Invalid HTML: CamperLink renders an <a>, which cannot be nested inside <button>.
    // Outer clickable should be a div[role=button] instead.
    const { container } = render(
      <BunkRequestRow
        request={makeRequest({ id: 'req-a', requestee_id: 200 })}
        targetPerson={makePerson()}
        onSelect={() => {}}
      />
    )
    const row = container.firstElementChild as HTMLElement
    expect(row.tagName).toBe('DIV')
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')
  })

  it('fires onSelect when Enter is pressed on the focusable row', async () => {
    const onSelect = vi.fn()
    render(
      <BunkRequestRow
        request={makeRequest({ id: 'req-a', requestee_id: 200 })}
        targetPerson={makePerson()}
        onSelect={onSelect}
      />
    )
    const row = screen.getByRole('button', { name: /bunk with.*olivia chen/i })
    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('fires onSelect when Space is pressed on the focusable row', async () => {
    const onSelect = vi.fn()
    render(
      <BunkRequestRow
        request={makeRequest({ id: 'req-a', requestee_id: 200 })}
        targetPerson={makePerson()}
        onSelect={onSelect}
      />
    )
    const row = screen.getByRole('button', { name: /bunk with.*olivia chen/i })
    row.focus()
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('renders the supplied badge node after the mutual badge', () => {
    render(
      <BunkRequestRow
        request={makeRequest({ id: 'req-a', requestee_id: 200, is_reciprocal: true })}
        targetPerson={makePerson()}
        badge={<span data-testid="current-badge">Current request</span>}
      />
    )
    const mutual = screen.getByText('mutual')
    const current = screen.getByTestId('current-badge')

    expect(mutual.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  describe('declined requests with a valid requestee', () => {
    it('renders a clickable CamperLink for a declined request with a valid requestee_id', () => {
      render(
        <BunkRequestRow
          request={makeRequest({
            status: 'declined',
            requestee_id: 200,
            requested_person_name: 'Olivia Chen',
            disposition_reason: 'session_mismatch',
          })}
          targetPerson={makePerson({ first_name: 'Olivia', last_name: 'Chen' })}
        />
      )
      // A CamperLink in clickable form renders as an <a> wrapping the name and
      // an ExternalLink icon. The unresolved span never renders.
      const link = screen.getByRole('link', { name: /Olivia Chen/ })
      expect(link).toBeInTheDocument()
      expect(link.getAttribute('href')).toBe('/camper/200')
      // The "(unresolved)" suffix is only rendered on the plain-text branch;
      // guard against regressing back to that branch.
      expect(screen.queryByText(/\(unresolved\)/i)).toBeNull()
    })

    it('renders the disposition reason text from request.disposition_reason for a declined request', () => {
      render(
        <BunkRequestRow
          request={makeRequest({
            status: 'declined',
            requestee_id: 200,
            requested_person_name: 'Olivia Chen',
            disposition_reason: 'session_mismatch',
          })}
          targetPerson={makePerson({ first_name: 'Olivia', last_name: 'Chen' })}
        />
      )
      // formatReason('session_mismatch') returns 'Different sessions'
      expect(screen.getByText(/Different sessions/)).toBeInTheDocument()
    })

    it('still renders resolved requests with a clickable link (regression guard)', () => {
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
      const link = screen.getByRole('link', { name: /Olivia Chen/ })
      expect(link).toBeInTheDocument()
      expect(link.getAttribute('href')).toBe('/camper/200')
    })

    it('pending request without a valid requestee_id still shows as unresolved plain text', () => {
      render(
        <BunkRequestRow
          request={makeRequest({
            status: 'pending',
            requested_person_name: 'Liam Garcia',
          })}
        />
      )
      // No <a> link: falls back to the italic unresolved text path.
      expect(screen.queryByRole('link')).toBeNull()
      expect(screen.getByText(/\(unresolved\)/i)).toBeInTheDocument()
    })

    it('does not render a disposition reason when request.disposition_reason is empty', () => {
      render(
        <BunkRequestRow
          request={makeRequest({
            status: 'declined',
            requestee_id: 200,
            requested_person_name: 'Olivia Chen',
          })}
          targetPerson={makePerson({ first_name: 'Olivia', last_name: 'Chen' })}
        />
      )
      expect(screen.queryByText(/Different sessions/)).toBeNull()
    })

    it('does not render a disposition reason for a resolved request even if set', () => {
      render(
        <BunkRequestRow
          request={makeRequest({
            status: 'resolved',
            requestee_id: 200,
            requested_person_name: 'Olivia Chen',
            disposition_reason: 'session_mismatch',
          })}
          targetPerson={makePerson({ first_name: 'Olivia', last_name: 'Chen' })}
        />
      )
      // Resolved rows suppress the reason render per the component contract.
      expect(screen.queryByText(/Different sessions/)).toBeNull()
    })
  })
})

describe('BunkRequestRow — material age preference marker', () => {
  function ageReq(overrides: Partial<BunkRequestsResponse> = {}): BunkRequestsResponse {
    return makeRequest({
      request_type: 'age_preference',
      age_preference_target: 'older',
      source_field: 'bunk_with',
      status: 'resolved',
      ...overrides,
    })
  }

  it('applies sparkle-material class when isMaterialAgePreference=true', () => {
    const { container } = render(
      <BunkRequestRow request={ageReq()} isMaterialAgePreference={true} />
    )
    const sparkle = container.querySelector('.sparkle-material')
    expect(sparkle).not.toBeNull()
  })

  it('does NOT apply sparkle-material class when isMaterialAgePreference=false', () => {
    const { container } = render(
      <BunkRequestRow
        request={ageReq({ source_field: 'socialize_with' })}
        isMaterialAgePreference={false}
      />
    )
    const sparkle = container.querySelector('.sparkle-material')
    expect(sparkle).toBeNull()
  })

  it('renders P badge when isMaterialAgePreference=true', () => {
    render(<BunkRequestRow request={ageReq()} isMaterialAgePreference={true} />)
    expect(screen.getByText('P')).toBeInTheDocument()
  })

  it('renders S badge when staffAgeBadge=true', () => {
    render(
      <BunkRequestRow request={ageReq({ source_field: 'bunking_notes' })} staffAgeBadge={true} />
    )
    expect(screen.getByText('S')).toBeInTheDocument()
  })

  it('renders neither badge for plain best-effort age row', () => {
    render(<BunkRequestRow request={ageReq({ source_field: 'socialize_with' })} />)
    expect(screen.queryByText('P')).toBeNull()
    expect(screen.queryByText('S')).toBeNull()
  })
})
