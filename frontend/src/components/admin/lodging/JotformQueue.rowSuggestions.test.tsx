/**
 * A write-in that looks like a filer is suggested ON THE FILER'S OWN ROW in
 * Needs a guest (kindred#2839 follow-up, owner report 2026-09-25: the
 * suggestion existed, but only in the separate Suggested links card, where
 * nobody looking at the filer's row saw it). The row reads the server's one
 * list, joined by submission id; the card keeps only suggestions with no row
 * there -- a linked filing not placed in the viewed scenario -- so nothing is
 * shown twice. A similar name is labelled so, and never pre-selects the
 * Write-in dropdown. Fictional names only.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JotformQueue } from './JotformQueue'

const act = { mutate: vi.fn(), isPending: false }
const queue = { data: undefined as unknown, isLoading: false, error: null as Error | null }
vi.mock('../../../hooks/useJotformAdmin', () => ({
  useJotformWeekendQueue: () => queue,
  useJotformSubmissionAction: () => act,
}))

const WW = 1000002

function filing(submissionId: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    submission_id: submissionId,
    session_cm_id: WW,
    submitted_name: name,
    submitted_at: '2026-08-31 09:00:00',
    match_status: 'unmatched',
    suggestions: [],
    ...extra,
  }
}

function suggestion(
  submissionId: string,
  occupant: string,
  filer: string,
  extra: Record<string, unknown> = {}
) {
  return {
    option_id: `u_cedar/${occupant}`,
    unit_id: 'u_cedar',
    unit_name: 'Cedar 3',
    occupant_name: occupant,
    submission_id: submissionId,
    filer_name: filer,
    linked_in: '',
    label: `Link to ${filer}'s filing`,
    similar: false,
    ...extra,
  }
}

beforeEach(() => {
  act.mutate.mockReset()
  queue.data = {
    year: 2026,
    session_cm_id: WW,
    scenario: '',
    unmatched: [
      filing('6600000000000000031', 'Emma Johnson', { nametag: 'Emmy' }),
      filing('6600000000000000032', 'Olivia Chen', { write_in_suggestion: 'u_cedar/Olivia Chen' }),
    ],
    write_ins: [
      filing('6600000000000000033', 'Riley Sam', {
        match_status: 'write_in',
        write_in_name: 'Riley Sam',
        write_in_placed: false,
      }),
    ],
    write_in_options: [
      { option_id: 'u_cedar/Emny', session_cm_id: WW, unit_id: 'u_cedar', occupant_name: 'Emny' },
      {
        option_id: 'u_cedar/Olivia Chen',
        session_cm_id: WW,
        unit_id: 'u_cedar',
        unit_name: 'Cedar 3',
        occupant_name: 'Olivia Chen',
      },
      { option_id: 'u_cedar/Riley', session_cm_id: WW, unit_id: 'u_cedar', occupant_name: 'Riley' },
    ],
    write_in_link_suggestions: [
      suggestion('6600000000000000031', 'Emny', 'Emma Johnson', {
        similar: true,
        label: "Similar name: link to Emma Johnson's filing?",
      }),
      suggestion('6600000000000000032', 'Olivia Chen', 'Olivia Chen'),
      suggestion('6600000000000000033', 'Riley', 'Riley Sam', {
        linked_in: 'the live board',
        label: "Link to Riley Sam's filing (linked in the live board)",
      }),
    ],
    guests: [],
  }
})

const row = (submissionId: string) => screen.getByTestId(`jotform-unmatched-${submissionId}`)

describe('JotformQueue — write-in suggestions on the filer’s row', () => {
  it('shows an exact write-in on its filer’s row, and Link links it', () => {
    render(<JotformQueue year={2026} sessionCmId={WW} scenario="" />)
    const olivia = row('6600000000000000032')
    expect(within(olivia).getByText('Write-in Olivia Chen · Cedar 3')).toBeInTheDocument()
    fireEvent.click(within(olivia).getByRole('button', { name: 'Link write-in Olivia Chen' }))
    expect(act.mutate).toHaveBeenCalledWith({
      kind: 'write_in',
      submissionId: '6600000000000000032',
      unitId: 'u_cedar',
      occupantName: 'Olivia Chen',
    })
  })

  it('labels a similar name so, and it never pre-selects the dropdown', () => {
    render(<JotformQueue year={2026} sessionCmId={WW} scenario="" />)
    const emma = row('6600000000000000031')
    expect(within(emma).getByText('Similar name: write-in Emny · Cedar 3')).toBeInTheDocument()
    expect(
      within(emma).getByRole('button', { name: 'Write-in for Emma Johnson' })
    ).toHaveTextContent('Choose a write-in…')
    fireEvent.click(within(emma).getByRole('button', { name: 'Link write-in Emny' }))
    expect(act.mutate).toHaveBeenCalledWith({
      kind: 'write_in',
      submissionId: '6600000000000000031',
      unitId: 'u_cedar',
      occupantName: 'Emny',
    })
  })

  it('keeps only a suggestion with no row in Needs a guest in the Suggested links card', () => {
    render(<JotformQueue year={2026} sessionCmId={WW} scenario="" />)
    const card = screen.getByTestId('jotform-suggested-links')
    expect(within(card).getByRole('heading')).toHaveTextContent('Suggested links (1)')
    expect(
      within(card).getByText("Link to Riley Sam's filing (linked in the live board)")
    ).toBeInTheDocument()
    expect(within(card).queryByText(/Emma Johnson/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/Olivia Chen/)).not.toBeInTheDocument()
    // Each suggestion is shown once, across the rows and the card.
    expect(screen.getAllByText(/Emny · Cedar 3/)).toHaveLength(1)
    expect(screen.getAllByText(/Write-in Olivia Chen · Cedar 3/)).toHaveLength(1)
  })

  it('draws no card when every suggestion has its row', () => {
    const data = queue.data as { write_in_link_suggestions: unknown[] }
    data.write_in_link_suggestions = data.write_in_link_suggestions.slice(0, 2)
    render(<JotformQueue year={2026} sessionCmId={WW} scenario="" />)
    expect(screen.queryByTestId('jotform-suggested-links')).not.toBeInTheDocument()
  })
})
