/**
 * The Requests tab reads write-in links in the scenario being viewed
 * (kindred#2828 ruling 2026-09-25): "placed in <unit>" or "not placed", the
 * Write-in dropdown from that scenario's write-ins, and suggested links that
 * are a label and a button -- never a link made on their own. The hooks are
 * mocked; the network and invalidation contract is in
 * `useJotformAdmin.test.tsx`. Fictional names only.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JotformQueue } from './JotformQueue'

const act = { mutate: vi.fn(), isPending: false }
const weekendQueue = vi.fn()
vi.mock('../../../hooks/useJotformAdmin', () => ({
  useJotformWeekendQueue: (year: number, sessionCmId: number, scenario: string) =>
    weekendQueue(year, sessionCmId, scenario) as unknown,
  useJotformSubmissionAction: () => act,
}))

const NEEDS = {
  submission_id: '6600000000000000011',
  session_cm_id: 1000002,
  submitted_name: 'Samuel Johnson',
  nametag: 'Sam',
  submitted_at: '2026-08-31 09:00:00',
  match_status: 'unmatched',
  suggestions: [],
}

const LINKED = {
  submission_id: '6600000000000000014',
  session_cm_id: 1000002,
  submitted_name: 'Olivia Chen',
  submitted_at: '2026-08-29 09:00:00',
  match_status: 'write_in',
  write_in_name: 'Liv C.',
}

/** What the server says for each scope: the live board and Plan A. */
const BY_SCENARIO: Record<string, unknown> = {
  '': {
    year: 2026,
    session_cm_id: 1000002,
    scenario: '',
    unmatched: [{ ...NEEDS, write_in_suggestion: '' }],
    write_ins: [{ ...LINKED, write_in_placed: true, write_in_unit: 'Cedar 3' }],
    write_in_options: [
      {
        option_id: 'u_cedar/Liv C.',
        session_cm_id: 1000002,
        unit_id: 'u_cedar',
        unit_name: 'Cedar 3',
        occupant_name: 'Liv C.',
      },
    ],
    write_in_link_suggestions: [],
  },
  scn_a: {
    year: 2026,
    session_cm_id: 1000002,
    scenario: 'scn_a',
    unmatched: [{ ...NEEDS, write_in_suggestion: 'u_oak/Sam Johnson' }],
    write_ins: [{ ...LINKED, write_in_placed: false, write_in_unit: '' }],
    write_in_options: [
      {
        option_id: 'u_oak/Sam Johnson',
        session_cm_id: 1000002,
        unit_id: 'u_oak',
        unit_name: 'Oak 2',
        occupant_name: 'Sam Johnson',
      },
      {
        option_id: 'u_fern/olivia chen',
        session_cm_id: 1000002,
        unit_id: 'u_fern',
        unit_name: 'Fern 1',
        occupant_name: 'olivia chen',
      },
    ],
    write_in_link_suggestions: [
      {
        option_id: 'u_fern/olivia chen',
        unit_id: 'u_fern',
        unit_name: 'Fern 1',
        occupant_name: 'olivia chen',
        submission_id: '6600000000000000014',
        filer_name: 'Olivia Chen',
        linked_in: 'the live board',
        label: "Link to Olivia Chen's filing (linked in the live board)",
      },
    ],
  },
}

beforeEach(() => {
  act.mutate.mockReset()
  weekendQueue.mockReset()
  weekendQueue.mockImplementation((_year: number, _session: number, scenario: string) => ({
    data: BY_SCENARIO[scenario],
    isLoading: false,
    error: null,
  }))
})

describe('JotformQueue — read in the viewed scenario', () => {
  it('asks for this weekend in the scenario being viewed', () => {
    render(<JotformQueue year={2026} sessionCmId={1000002} scenario="scn_a" />)
    expect(weekendQueue).toHaveBeenLastCalledWith(2026, 1000002, 'scn_a')
  })

  it('says where a linked write-in is placed on the live board', () => {
    render(<JotformQueue year={2026} sessionCmId={1000002} scenario="" />)
    const list = screen.getByTestId('jotform-write-ins')
    expect(list).toHaveTextContent('Olivia Chen')
    expect(list).toHaveTextContent('→ Liv C. · placed in Cedar 3')
  })

  it('says a linked write-in is not placed in a scenario that lacks it, and keeps it linked', () => {
    render(<JotformQueue year={2026} sessionCmId={1000002} scenario="scn_a" />)
    const list = screen.getByTestId('jotform-write-ins')
    expect(list).toHaveTextContent('Write-ins (1)')
    expect(list).toHaveTextContent('→ Liv C. · not placed in this scenario')
    expect(within(list).getByRole('button', { name: 'Unlink Olivia Chen' })).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-unmatched-6600000000000000014')).not.toBeInTheDocument()
  })

  it('switching scenario changes the placement and the Write-in dropdown', () => {
    const { rerender } = render(<JotformQueue year={2026} sessionCmId={1000002} scenario="" />)
    const optionsOf = () =>
      within(
        within(screen.getByTestId('jotform-unmatched-6600000000000000011')).getByRole('combobox', {
          name: 'Write-in for Samuel Johnson',
        })
      )
        .getAllByRole('option')
        .map((option) => option.textContent)
    expect(optionsOf()).toEqual(['Choose a write-in…', 'Liv C. · Cedar 3'])

    rerender(<JotformQueue year={2026} sessionCmId={1000002} scenario="scn_a" />)

    expect(weekendQueue).toHaveBeenLastCalledWith(2026, 1000002, 'scn_a')
    expect(optionsOf()).toEqual([
      'Choose a write-in…',
      'Sam Johnson · Oak 2',
      'olivia chen · Fern 1',
    ])
    expect(screen.getByTestId('jotform-write-ins')).toHaveTextContent('not placed in this scenario')
  })

  it("pre-selects the scenario's matching write-in once the scenario is opened", () => {
    const { rerender } = render(<JotformQueue year={2026} sessionCmId={1000002} scenario="" />)
    rerender(<JotformQueue year={2026} sessionCmId={1000002} scenario="scn_a" />)
    const item = screen.getByTestId('jotform-unmatched-6600000000000000011')
    expect(within(item).getByRole('combobox', { name: 'Write-in for Samuel Johnson' })).toHaveValue(
      'u_oak/Sam Johnson'
    )
  })
})

describe('JotformQueue — suggested links', () => {
  it('labels a suggestion and links it only when clicked', () => {
    render(<JotformQueue year={2026} sessionCmId={1000002} scenario="scn_a" />)
    const section = screen.getByTestId('jotform-suggested-links')
    expect(section).toHaveTextContent('Suggested links (1)')
    expect(section).toHaveTextContent('olivia chen · Fern 1')
    expect(section).toHaveTextContent("Link to Olivia Chen's filing (linked in the live board)")
    expect(act.mutate).not.toHaveBeenCalled()

    fireEvent.click(
      within(section).getByRole('button', { name: "Link olivia chen to Olivia Chen's filing" })
    )

    expect(act.mutate).toHaveBeenCalledTimes(1)
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'write_in',
      submissionId: '6600000000000000014',
      unitId: 'u_fern',
      occupantName: 'olivia chen',
    })
  })

  it('draws no section when nothing is suggested', () => {
    render(<JotformQueue year={2026} sessionCmId={1000002} scenario="" />)
    expect(screen.queryByTestId('jotform-suggested-links')).not.toBeInTheDocument()
  })
})
