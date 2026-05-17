import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AllCamperRequestsModal } from './AllCamperRequestsModal'

// Fixture arrays mutated per-test
let bunkRequestsFixture: Array<Record<string, unknown>> = []
let personsFixture: Array<Record<string, unknown>> = []
const updateMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('react-hot-toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
  default: Object.assign(vi.fn(), {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  }),
}))

// Candidates offered in the target-picker dropdown (session campers for attendees query)
let attendeesFixture: Array<Record<string, unknown>> = []

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => ({
      getFullList: () => {
        if (name === 'persons') return Promise.resolve(personsFixture)
        if (name === 'attendees') return Promise.resolve(attendeesFixture)
        return Promise.resolve(bunkRequestsFixture)
      },
      update: (...args: unknown[]) => updateMock(...args),
    }),
  },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, isLoading: false }),
}))

vi.mock('react-router', () => ({
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...props}>{children}</a>
  ),
  BrowserRouter: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

beforeEach(() => {
  bunkRequestsFixture = []
  personsFixture = []
  attendeesFixture = []
  updateMock.mockReset()
  updateMock.mockResolvedValue({})
  toastSuccessMock.mockReset()
  toastErrorMock.mockReset()
})

function renderModal(overrides: Partial<React.ComponentProps<typeof AllCamperRequestsModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AllCamperRequestsModal
        isOpen={true}
        onClose={vi.fn()}
        requesterCmId={1000001}
        requesterName="Emma Johnson"
        year={2026}
        currentRequestId={null}
        {...overrides}
      />
    </QueryClientProvider>
  )
}

describe('AllCamperRequestsModal shell', () => {
  it('renders the camper name in the title', async () => {
    renderModal()
    expect(await screen.findByText(/Emma Johnson/)).toBeTruthy()
  })

  it('shows the empty-state when the camper has no requests', async () => {
    renderModal()
    expect(await screen.findByText(/No other requests from this camper/i)).toBeTruthy()
  })

  it('fires onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    const close = await screen.findByLabelText(/close/i)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not render when isOpen is false', () => {
    const { container } = renderModal({ isOpen: false })
    expect(container.textContent).not.toContain('Emma Johnson')
  })
})

describe('AllCamperRequestsModal cards', () => {
  it('renders one card per non-merged request with Liam Garcia as target', async () => {
    bunkRequestsFixture = [
      {
        id: 'req1',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.98,
        source_field: 'bunk_with',
        source_fragment: 'Liam Garcia',
        parse_notes: 'Explicit name match.',
        is_reciprocal: true,
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    // findByText may match multiple occurrences (CamperLink + source_fragment); use getAllByText
    expect((await screen.findAllByText('Liam Garcia')).length).toBeGreaterThanOrEqual(1)
  })

  it('labels source pill using formatSourceField for socialize_with', async () => {
    bunkRequestsFixture = [
      {
        id: 'req1',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.98,
        source_field: 'socialize_with',
        source_fragment: 'Liam Garcia',
        parse_notes: 'Derived from socialize checkbox.',
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    // formatSourceField('socialize_with') returns 'Social With Checkbox' (renamed in #950)
    expect(await screen.findByText('Social With Checkbox')).toBeTruthy()
  })

  it('renders processing notes from parse_notes', async () => {
    bunkRequestsFixture = [
      {
        id: 'req1',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.98,
        source_field: 'bunk_with',
        source_fragment: 'Liam Garcia',
        parse_notes: 'Explicit name match; mutual pair.',
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    expect(await screen.findByText(/Explicit name match/)).toBeTruthy()
  })

  it('never renders a "Current request" chip inside the modal', async () => {
    bunkRequestsFixture = [
      {
        id: 'req1',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.98,
        source_field: 'bunk_with',
        source_fragment: 'Liam Garcia',
        parse_notes: 'n',
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal({ currentRequestId: 'req1' })
    // findAllByText handles multiple matches (CamperLink + source_fragment)
    expect((await screen.findAllByText('Liam Garcia')).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/Current request/i)).toBeNull()
  })

  it('renders a "Viewing" chip on the card matching currentRequestId', async () => {
    bunkRequestsFixture = [
      {
        id: 'req1',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.98,
        source_field: 'bunk_with',
        source_fragment: 'Liam Garcia',
        parse_notes: 'n',
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal({ currentRequestId: 'req1' })
    expect(await screen.findByText('Viewing')).toBeTruthy()
  })

  it('renders age_preference request below "Age preference" divider', async () => {
    bunkRequestsFixture = [
      {
        id: 'req1',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.98,
        source_field: 'bunk_with',
        source_fragment: 'Liam Garcia',
        parse_notes: 'n',
        year: 2026,
      },
      {
        id: 'reqAge',
        request_type: 'age_preference',
        age_preference_target: 'older',
        status: 'resolved',
        confidence_score: 0.92,
        source_field: 'bunking_notes',
        source_fragment: 'prefer older',
        parse_notes: 'Parsed as older.',
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    // DOM order: bunk_with type chip ("Bunk with") → divider span ("Age preference") → age_preference card with text "older"
    // The divider span is the FIRST "Age preference" span; the type chip on the age card is the SECOND.
    const allAgePrefSpans = await screen.findAllByText('Age preference', { selector: 'span' })
    expect(allAgePrefSpans.length).toBeGreaterThanOrEqual(1)
    const divider = allAgePrefSpans[0]!
    // age_preference_target now shows in the EditableRequestTarget button as "Prefers older".
    const ageCardButton = screen.getByRole('button', { name: /Prefers older/i })
    expect(
      divider.compareDocumentPosition(ageCardButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

describe('AllCamperRequestsModal framing (no read-only language)', () => {
  it('does not mention "read-only" anywhere', async () => {
    bunkRequestsFixture = [
      {
        id: 'req1',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'pending',
        confidence_score: 0.98,
        source_field: 'bunk_with',
        source_fragment: 'Liam Garcia',
        parse_notes: 'n',
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    await screen.findByRole('button', { name: /^approve$/i })
    // Modal portals into document.body, so query the dialog itself rather than
    // the test render container (which would make these negative assertions
    // trivially pass).
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent?.toLowerCase()).not.toContain('read-only')
    expect(dialog.textContent?.toLowerCase()).not.toContain('read only')
    expect(dialog.textContent?.toLowerCase()).not.toContain('use the main table to take actions')
  })
})

describe('AllCamperRequestsModal inline actions', () => {
  const pendingBunkWith = {
    id: 'req1',
    request_type: 'bunk_with',
    requestee_id: 1000002,
    requested_person_name: 'Liam Garcia',
    status: 'pending',
    confidence_score: 0.98,
    source_field: 'bunk_with',
    source_fragment: 'Liam Garcia',
    parse_notes: 'n',
    is_reciprocal: false,
    year: 2026,
  }

  it('renders an Approve button per card', async () => {
    bunkRequestsFixture = [pendingBunkWith]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    expect(await screen.findByRole('button', { name: /^approve$/i })).toBeTruthy()
  })

  it('renders a Decline button per card', async () => {
    bunkRequestsFixture = [pendingBunkWith]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    expect(await screen.findByRole('button', { name: /^decline$/i })).toBeTruthy()
  })

  it('clicking Approve opens a confirmation popover', async () => {
    bunkRequestsFixture = [pendingBunkWith]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: /^approve$/i }))
    expect(screen.getByText(/approve this request\?/i)).toBeTruthy()
  })

  it('confirming Approve calls pb.update with status=resolved + staff_touched=true', async () => {
    bunkRequestsFixture = [pendingBunkWith]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: /^approve$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^confirm$/i }))
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('req1', {
        status: 'resolved',
        staff_touched: true,
      })
    )
  })

  it('confirming Decline calls pb.update with status=declined + staff_touched=true', async () => {
    bunkRequestsFixture = [pendingBunkWith]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: /^decline$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^confirm$/i }))
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('req1', {
        status: 'declined',
        staff_touched: true,
      })
    )
  })

  it('shows a success toast and closes the popover after successful approve', async () => {
    bunkRequestsFixture = [pendingBunkWith]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: /^approve$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^confirm$/i }))
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/approve this request\?/i)).toBeNull())
  })

  it('shows an error toast and keeps the popover open when the mutation fails', async () => {
    updateMock.mockReset()
    updateMock.mockRejectedValue(new Error('network down'))
    bunkRequestsFixture = [pendingBunkWith]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: /^approve$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^confirm$/i }))
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
    // Popover should still be visible so the user can retry or cancel.
    expect(screen.getByText(/approve this request\?/i)).toBeTruthy()
  })
})

describe('AllCamperRequestsModal status counts', () => {
  it('renders accurate resolved/pending/declined counts in the header', async () => {
    bunkRequestsFixture = [
      {
        id: 'r1',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.9,
        year: 2026,
      },
      {
        id: 'r2',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.9,
        year: 2026,
      },
      {
        id: 'r3',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'pending',
        confidence_score: 0.9,
        year: 2026,
      },
      {
        id: 'r4',
        request_type: 'not_bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'declined',
        confidence_score: 0.9,
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    // Scope to the header counts row (identified by the "4 requests" label)
    // so we don't match status words that also appear on card pills.
    const countsRow = (await screen.findByText(/4 requests/i)).parentElement!
    expect(countsRow.textContent).toMatch(/2\s+resolved/)
    expect(countsRow.textContent).toMatch(/1\s+pending/)
    expect(countsRow.textContent).toMatch(/1\s+declined/)
  })
})

describe('AllCamperRequestsModal accessibility', () => {
  it('labels the dialog with the rendered heading via aria-labelledby', async () => {
    bunkRequestsFixture = [
      {
        id: 'r1',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'pending',
        confidence_score: 0.9,
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    const dialog = await screen.findByRole('dialog')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const labelEl = document.getElementById(labelledBy!)
    expect(labelEl).not.toBeNull()
    expect(labelEl!.textContent).toMatch(/Emma Johnson/)
  })
})

// ---------------------------------------------------------------------------
// Target-picker in AllCamperRequestsModal (feedback item #7)
// ---------------------------------------------------------------------------
describe('AllCamperRequestsModal — target picker', () => {
  const unresolvedRequest = {
    id: 'req-target-1',
    request_type: 'bunk_with',
    status: 'pending',
    requester_id: 100,
    requestee_id: 0,
    requested_person_name: 'Liam Garcia',
    session_id: 1000001,
    year: 2025,
    confidence_score: 0.5,
    is_reciprocal: false,
    created: '2025-01-01',
    updated: '2025-01-01',
  }

  const oliviaChenAttendee = {
    id: 'att-1',
    expand: {
      person: {
        id: 'p-olivia',
        cm_id: 200,
        first_name: 'Olivia',
        last_name: 'Chen',
        year: 2025,
        age: 12,
        grade: 7,
        gender: 'F',
        created: '2025-01-01',
        updated: '2025-01-01',
      },
    },
  }

  it('shows the EditableRequestTarget dropdown trigger for a non-age-preference request', async () => {
    // A pending request with a mis-matched name ("Liam Garcia" but no requestee_id resolved)
    bunkRequestsFixture = [unresolvedRequest]
    personsFixture = []
    // Olivia Chen is a session camper staff can pick instead
    attendeesFixture = [oliviaChenAttendee]

    renderModal({ requesterCmId: 100, year: 2025 })
    await screen.findByText(/Liam Garcia/)

    // The EditableRequestTarget renders a button to open the picker
    const pickerButton = screen.getByRole('button', { name: /Liam Garcia \(unresolved\)/i })
    expect(pickerButton).toBeInTheDocument()
  })

  it('updates requestee_id via PocketBase when staff selects a different candidate', async () => {
    bunkRequestsFixture = [{ ...unresolvedRequest, id: 'req-target-2' }]
    personsFixture = []
    attendeesFixture = [oliviaChenAttendee]

    renderModal({ requesterCmId: 100, year: 2025 })
    await screen.findByText(/Liam Garcia/)

    // Open the picker dropdown
    const pickerButton = screen.getByRole('button', { name: /Liam Garcia \(unresolved\)/i })
    fireEvent.click(pickerButton)

    // Olivia Chen should appear as a selectable option
    const oliviaOption = await screen.findByRole('button', { name: /Olivia Chen/i })
    fireEvent.click(oliviaOption)

    // Verify PocketBase update was called with the correct requestee_id
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        'req-target-2',
        expect.objectContaining({ requestee_id: 200 })
      )
    )
  })

  // ---------------------------------------------------------------------------
  // Modal target/type pickers must mirror row-level behavior: visible and
  // editable for ANY status (resolved/declined/pending).
  // ---------------------------------------------------------------------------

  it('renders EditableRequestTarget (enabled) for a resolved request', async () => {
    const resolvedRequest = {
      id: 'req-resolved-1',
      request_type: 'bunk_with',
      status: 'resolved',
      requester_id: 100,
      requestee_id: 200,
      requested_person_name: 'Olivia Chen',
      session_id: 1000001,
      year: 2025,
      confidence_score: 1.0,
      is_reciprocal: false,
      created: '2025-01-01',
      updated: '2025-01-01',
    }
    bunkRequestsFixture = [resolvedRequest]
    personsFixture = [{ cm_id: 200, first_name: 'Olivia', last_name: 'Chen', year: 2025 }]
    attendeesFixture = []

    renderModal({ requesterCmId: 100, year: 2025 })

    const pickerButton = await screen.findByRole('button', { name: /^Olivia Chen$/i })
    expect(pickerButton).toBeInTheDocument()
    expect(pickerButton).not.toBeDisabled()
  })

  it('renders EditableRequestTarget (enabled) for a declined request', async () => {
    const declinedRequest = {
      id: 'req-declined-1',
      request_type: 'bunk_with',
      status: 'declined',
      requester_id: 100,
      requestee_id: 200,
      requested_person_name: 'Olivia Chen',
      session_id: 1000001,
      year: 2025,
      confidence_score: 0.6,
      is_reciprocal: false,
      created: '2025-01-01',
      updated: '2025-01-01',
    }
    bunkRequestsFixture = [declinedRequest]
    personsFixture = [{ cm_id: 200, first_name: 'Olivia', last_name: 'Chen', year: 2025 }]
    attendeesFixture = [oliviaChenAttendee]

    renderModal({ requesterCmId: 100, year: 2025 })

    const pickerButton = await screen.findByRole('button', { name: /^Olivia Chen$/i })
    expect(pickerButton).toBeInTheDocument()
    expect(pickerButton).not.toBeDisabled()
  })

  it('renders EditableRequestType picker for any non-age request', async () => {
    const resolvedRequest = {
      id: 'req-type-1',
      request_type: 'bunk_with',
      status: 'resolved',
      requester_id: 100,
      requestee_id: 200,
      requested_person_name: 'Olivia Chen',
      session_id: 1000001,
      year: 2025,
      confidence_score: 1.0,
      is_reciprocal: false,
      created: '2025-01-01',
      updated: '2025-01-01',
    }
    bunkRequestsFixture = [resolvedRequest]
    personsFixture = [{ cm_id: 200, first_name: 'Olivia', last_name: 'Chen', year: 2025 }]
    attendeesFixture = []

    renderModal({ requesterCmId: 100, year: 2025 })

    // EditableRequestType renders a button labeled "Bunk With"
    expect(await screen.findByRole('button', { name: /^Bunk With$/i })).toBeInTheDocument()
  })

  it('renders EditableRequestTarget (not CamperLink) for an unresolved non-age request when onTargetChange is provided', async () => {
    // Unresolved: requestee_id is 0, no person match
    bunkRequestsFixture = [unresolvedRequest]
    personsFixture = []
    attendeesFixture = [oliviaChenAttendee]

    renderModal({ requesterCmId: 100, year: 2025 })

    // Must find the editable picker trigger
    const pickerButton = await screen.findByRole('button', { name: /Liam Garcia \(unresolved\)/i })
    expect(pickerButton).toBeInTheDocument()

    // Must NOT find a CamperLink (no resolved target)
    expect(screen.queryByRole('link', { name: /Liam Garcia/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// staff_touched badge (issue #1458)
// ---------------------------------------------------------------------------
describe('AllCamperRequestsModal — staff_touched badge', () => {
  it('renders a "staff edited" badge on cards with staff_touched=true', async () => {
    bunkRequestsFixture = [
      {
        id: 'r-touched',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.9,
        source_field: 'bunk_with',
        source_fragment: 'Liam Garcia',
        parse_notes: 'n',
        staff_touched: true,
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    expect(await screen.findByText(/staff edited/i)).toBeInTheDocument()
  })

  it('does not render a "staff edited" badge when staff_touched is false/undefined', async () => {
    bunkRequestsFixture = [
      {
        id: 'r-pristine',
        request_type: 'bunk_with',
        requestee_id: 1000002,
        requested_person_name: 'Liam Garcia',
        status: 'resolved',
        confidence_score: 0.9,
        source_field: 'bunk_with',
        source_fragment: 'Liam Garcia',
        parse_notes: 'n',
        year: 2026,
      },
    ]
    personsFixture = [{ cm_id: 1000002, first_name: 'Liam', last_name: 'Garcia', year: 2026 }]
    renderModal()
    // Wait for card to render
    await screen.findByText('Liam Garcia')
    expect(screen.queryByText(/staff edited/i)).toBeNull()
  })
})
