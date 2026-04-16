import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AllCamperRequestsModal } from './AllCamperRequestsModal'

// Fixture arrays mutated per-test
let bunkRequestsFixture: Array<Record<string, unknown>> = []
let personsFixture: Array<Record<string, unknown>> = []

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => ({
      getFullList: () => Promise.resolve(name === 'persons' ? personsFixture : bunkRequestsFixture),
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
        priority: 4,
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
        priority: 4,
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
        priority: 4,
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
        priority: 4,
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
        priority: 4,
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
        priority: 4,
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
        priority: 3,
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
    // 'older' appears both in the age_preference_target <strong> and in source_fragment blockquote;
    // use the <strong> element which is the age preference target display.
    const ageCard = screen.getByText('older', { selector: 'strong' })
    expect(divider.compareDocumentPosition(ageCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
