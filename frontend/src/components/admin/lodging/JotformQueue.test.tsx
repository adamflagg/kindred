/**
 * The weekend Requests tab's queue (kindred#2759; moved off the Manage Jotform
 * tab by the kindred#2828 ruling of 2026-09-25): the unmatched filings with
 * their labelled suggestions, duplicates and staff links. These cases lived in
 * `JotformPanel.test.tsx` while the queue rendered there; they are the same
 * assertions, rendered where the queue now is. The hooks are mocked; their
 * network and invalidation contract is pinned in `useJotformAdmin.test.tsx`.
 * Fictional names only.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JotformQueue } from './JotformQueue'

const act = { mutate: vi.fn(), isPending: false }
const queue = { data: undefined as unknown, isLoading: false, error: null as Error | null }
vi.mock('../../../hooks/useJotformAdmin', () => ({
  // The tab reads one weekend at a time; the fixture holds two weekends so the
  // per-weekend filtering stays pinned whatever the server scopes.
  useJotformWeekendQueue: () => queue,
  useJotformSubmissionAction: () => act,
}))

function renderQueue(sessionCmId = 1000002) {
  return render(<JotformQueue year={2026} sessionCmId={sessionCmId} scenario="" />)
}

beforeEach(() => {
  act.mutate.mockReset()
  queue.data = {
    year: 2026,
    unmatched: [
      {
        submission_id: '6600000000000000002',
        session_cm_id: 1000002,
        session_name: "Women's Weekend",
        submitted_name: 'Emma Ohnson',
        submitted_at: '2026-08-31 09:00:00',
        bunking_request: 'Olivia Chen',
        match_status: 'unmatched',
        suggestions: [
          {
            kind: 'did_you_mean',
            label: 'Did you mean Emma Johnson?',
            person_cm_id: 1000005,
            guest_name: 'Emma Johnson',
          },
        ],
      },
    ],
    resolved: [
      {
        submission_id: '6600000000000000003',
        session_cm_id: 1000002,
        submitted_name: 'Liam Riley',
        submitted_at: '2026-09-01 09:00:00',
        match_status: 'staff',
        person_cm_id: 1000006,
        guest_name: 'Liam Garcia',
      },
    ],
    duplicates: [
      {
        person_cm_id: 1000004,
        guest_name: 'Olivia Chen',
        session_cm_id: 1000002,
        change_kind: 'list',
        submissions: [
          {
            submission_id: '66a',
            session_cm_id: 1000002,
            submitted_name: 'Olivia Chen',
            submitted_at: '2026-08-03 09:00:00',
            match_status: 'auto',
            bunking_request: 'Emma Johnson',
          },
          {
            submission_id: '66b',
            session_cm_id: 1000002,
            submitted_name: 'Olivia Chen',
            submitted_at: '2026-08-31 09:00:00',
            match_status: 'auto',
            bunking_request: 'Emma Johnson, Riley Sam',
          },
        ],
      },
    ],
    guests: [
      {
        person_cm_id: 1000005,
        display_name: 'Emma Johnson',
        session_cm_id: 1000002,
        has_submission: false,
      },
      {
        person_cm_id: 1000006,
        display_name: 'Liam Garcia',
        session_cm_id: 1000002,
        has_submission: true,
      },
    ],
  }
})

describe('JotformQueue — the Requests tab queue', () => {
  it("says once that matching hasn't run for a weekend with no name mapped", () => {
    const data = queue.data as { unmatched: unknown[]; unmapped?: unknown[] }
    data.unmatched = []
    data.unmapped = [{ session_cm_id: 1000002, session_name: "Women's Weekend" }]
    const { unmount } = renderQueue()
    expect(
      screen.getByText(
        "Matching hasn't run for Women's Weekend: first and last name aren't mapped yet."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Every submission is matched to a guest.')).not.toBeInTheDocument()
    unmount()
    renderQueue(1000003)
    expect(screen.queryByText(/Matching hasn't run/)).not.toBeInTheDocument()
  })

  it('links a suggestion, links by hand, and ignores', () => {
    renderQueue()
    const item = screen.getByTestId('jotform-unmatched-6600000000000000002')
    expect(within(item).getByText('Did you mean Emma Johnson?')).toBeInTheDocument()
    fireEvent.click(within(item).getByRole('button', { name: 'Link to Emma Johnson' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'link',
      submissionId: '6600000000000000002',
      personCmId: 1000005,
    })

    fireEvent.change(within(item).getByRole('combobox', { name: 'Guest for Emma Ohnson' }), {
      target: { value: '1000006' },
    })
    fireEvent.click(within(item).getByRole('button', { name: 'Link chosen guest' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'link',
      submissionId: '6600000000000000002',
      personCmId: 1000006,
    })

    fireEvent.click(within(item).getByRole('button', { name: 'Ignore' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'ignore',
      submissionId: '6600000000000000002',
    })
  })

  it('offers no Link for a suggestion that points at another submission, not a guest', () => {
    // A "likely duplicate" can name another UNMATCHED submission: there is no
    // person to link to, so the label shows and no Link button does.
    const data = queue.data as { unmatched: Array<{ suggestions: unknown[] }> }
    data.unmatched[0]!.suggestions = [
      {
        kind: 'likely_duplicate',
        label: 'Likely the same person as Emma Ohnsen’s submission',
        person_cm_id: 0,
        other_submission_id: '6600000000000000009',
      },
    ]
    renderQueue()
    const item = screen.getByTestId('jotform-unmatched-6600000000000000002')
    expect(
      within(item).getByText('Likely the same person as Emma Ohnsen’s submission')
    ).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /^Link to/ })).not.toBeInTheDocument()
  })

  it('unlinks a staff link and shows duplicates with their filings', () => {
    renderQueue()
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Liam Riley' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'unlink',
      submissionId: '6600000000000000003',
    })
    const group = screen.getByTestId('jotform-duplicate-1000004')
    expect(group).toHaveTextContent('Olivia Chen')
    expect(group).toHaveTextContent('Emma Johnson, Riley Sam')
    expect(group).toHaveTextContent('Aug 3')
  })

  it('labels an ignored row Restore, which un-ignores it, and keeps Unlink for staff links', () => {
    // Un-ignoring is the same endpoint as unlinking, but "Unlink" on a row
    // that was never linked to anyone misdescribes what the button does.
    const data = queue.data as { resolved: Array<Record<string, unknown>> }
    data.resolved.push({
      submission_id: '6600000000000000004',
      session_cm_id: 1000002,
      submitted_name: 'Riley Sam',
      submitted_at: '2026-09-02 09:00:00',
      match_status: 'ignored',
      person_cm_id: 0,
    })
    renderQueue()
    expect(screen.queryByRole('button', { name: 'Unlink Riley Sam' })).not.toBeInTheDocument()
    const restore = screen.getByRole('button', { name: 'Restore Riley Sam' })
    expect(restore).toHaveTextContent('Restore')
    fireEvent.click(restore)
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'unlink',
      submissionId: '6600000000000000004',
    })
    expect(screen.getByRole('button', { name: 'Unlink Liam Riley' })).toHaveTextContent('Unlink')
  })

  it('offers no Link for a suggested person who is not an enrolled guest of the weekend', () => {
    // A likely duplicate can point at another filing whose person has since
    // left the weekend; the server refuses that link, so no button is drawn.
    const data = queue.data as { unmatched: Array<{ suggestions: unknown[] }> }
    data.unmatched[0]!.suggestions = [
      {
        kind: 'likely_duplicate',
        label: 'Likely a duplicate of Olivia Chen’s submission',
        person_cm_id: 1000009,
        guest_name: 'Olivia Chen',
        other_submission_id: '6600000000000000010',
      },
    ]
    renderQueue()
    const item = screen.getByTestId('jotform-unmatched-6600000000000000002')
    expect(
      within(item).getByText('Likely a duplicate of Olivia Chen’s submission')
    ).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /^Link to/ })).not.toBeInTheDocument()
  })

  it('says (no request) for a filing that left the bunking request empty', () => {
    const data = queue.data as {
      duplicates: Array<{ submissions: Array<{ bunking_request?: string }> }>
    }
    data.duplicates[0]!.submissions[0]!.bunking_request = ''
    renderQueue()
    const filing = screen.getByTestId('jotform-filing-66a')
    expect(filing).toHaveTextContent('Aug 3')
    expect(filing).toHaveTextContent('(no request)')
  })

  it("shows a guest who filed twice for each weekend once on each weekend's tab", () => {
    // A person can be enrolled in two adult weekends; the API returns one
    // group per (person, weekend).
    const data = queue.data as { duplicates: Array<Record<string, unknown>> }
    const first = data.duplicates[0]!
    data.duplicates.push({
      ...first,
      session_cm_id: 1000003,
      change_kind: 'identical',
      submissions: [
        {
          submission_id: '66c',
          session_cm_id: 1000003,
          submitted_name: 'Olivia Chen',
          submitted_at: '2026-09-05 09:00:00',
          match_status: 'auto',
          bunking_request: 'Samuel Johnson',
        },
      ],
    })
    const { unmount } = renderQueue()
    expect(screen.getAllByTestId('jotform-duplicate-1000004')).toHaveLength(1)
    expect(screen.getByTestId('jotform-duplicate-1000004')).not.toHaveTextContent('Samuel Johnson')
    unmount()
    renderQueue(1000003)
    expect(screen.getAllByTestId('jotform-duplicate-1000004')).toHaveLength(1)
    expect(screen.getByTestId('jotform-duplicate-1000004')).toHaveTextContent('Samuel Johnson')
  })

  it("filters the queue, duplicates and staff links to the weekend's own", () => {
    const data = queue.data as {
      unmatched: Array<Record<string, unknown>>
      resolved: Array<Record<string, unknown>>
      duplicates: Array<Record<string, unknown>>
    }
    data.unmatched.push({
      submission_id: '6600000000000000020',
      session_cm_id: 1000003,
      session_name: "Men's Weekend",
      submitted_name: 'Samuel Jonson',
      submitted_at: '2026-09-10 09:00:00',
      match_status: 'unmatched',
      suggestions: [],
    })
    data.resolved.push({
      submission_id: '6600000000000000021',
      session_cm_id: 1000003,
      submitted_name: 'Liam Garsia',
      submitted_at: '2026-09-11 09:00:00',
      match_status: 'ignored',
      person_cm_id: 0,
    })
    data.duplicates.push({
      person_cm_id: 1000008,
      guest_name: 'Riley Sam',
      session_cm_id: 1000003,
      change_kind: 'identical',
      submissions: [],
    })

    const { unmount } = renderQueue()
    expect(screen.getByTestId('jotform-unmatched-6600000000000000002')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-unmatched-6600000000000000020')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlink Liam Riley' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore Liam Garsia' })).not.toBeInTheDocument()
    expect(screen.getByTestId('jotform-duplicate-1000004')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-duplicate-1000008')).not.toBeInTheDocument()
    expect(screen.getByText('Needs a guest (1)')).toBeInTheDocument()
    unmount()

    renderQueue(1000003)
    expect(screen.getByTestId('jotform-unmatched-6600000000000000020')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-unmatched-6600000000000000002')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore Liam Garsia' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlink Liam Riley' })).not.toBeInTheDocument()
    expect(screen.getByTestId('jotform-duplicate-1000008')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-duplicate-1000004')).not.toBeInTheDocument()
  })
})

describe('JotformQueue — layout', () => {
  it('lists staff links and ignored filings as two sections, each with its own count', () => {
    const data = queue.data as { resolved: Array<Record<string, unknown>> }
    data.resolved.push({
      submission_id: '6600000000000000004',
      session_cm_id: 1000002,
      submitted_name: 'Riley Sam',
      submitted_at: '2026-09-02 09:00:00',
      match_status: 'ignored',
      person_cm_id: 0,
    })
    renderQueue()
    const links = screen.getByTestId('jotform-staff-links')
    const ignored = screen.getByTestId('jotform-ignored')
    expect(within(links).getByText('Staff links (1)')).toBeInTheDocument()
    expect(within(links).getByText('Liam Garcia', { exact: false })).toBeInTheDocument()
    expect(within(links).queryByText('Riley Sam')).not.toBeInTheDocument()
    expect(within(ignored).getByText('Ignored (1)')).toBeInTheDocument()
    expect(within(ignored).getByText('Riley Sam')).toBeInTheDocument()
  })

  it('says None yet in an empty staff-links or ignored section', () => {
    const data = queue.data as { resolved: unknown[] }
    data.resolved = []
    renderQueue()
    expect(
      within(screen.getByTestId('jotform-staff-links')).getByText('None yet')
    ).toBeInTheDocument()
    expect(within(screen.getByTestId('jotform-ignored')).getByText('None yet')).toBeInTheDocument()
  })

  it('tags each repeat filer Changed or Identical, and lists changed filers first', () => {
    const data = queue.data as { duplicates: Array<Record<string, unknown>> }
    data.duplicates.unshift({
      person_cm_id: 1000007,
      guest_name: 'Ava Martinez',
      session_cm_id: 1000002,
      change_kind: 'identical',
      submissions: [
        {
          submission_id: '66c',
          session_cm_id: 1000002,
          submitted_name: 'Ava Martinez',
          submitted_at: '2026-08-04 09:00:00',
          match_status: 'auto',
          bunking_request: 'Sophia Lee',
        },
        {
          submission_id: '66d',
          session_cm_id: 1000002,
          submitted_name: 'Ava Martinez',
          submitted_at: '2026-08-20 09:00:00',
          match_status: 'auto',
          bunking_request: 'Sophia Lee',
        },
      ],
    })
    renderQueue()
    const groups = screen.getAllByTestId(/^jotform-duplicate-/)
    expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual([
      'jotform-duplicate-1000004',
      'jotform-duplicate-1000007',
    ])
    expect(within(groups[0]!).getByText('Changed')).toBeInTheDocument()
    expect(within(groups[1]!).getByText('Identical')).toBeInTheDocument()
  })
})
