/**
 * The queue's cancelled registrations and board write-ins (kindred#2759
 * follow-up). The hooks are mocked; their network and invalidation contract is
 * pinned in `useJotformAdmin.test.tsx`. Fictional names only.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JotformQueue } from './JotformQueue'

const act = { mutate: vi.fn(), isPending: false }
const queue = { data: undefined as unknown, isLoading: false, error: null as Error | null }
vi.mock('../../../hooks/useJotformAdmin', () => ({
  useJotformQueue: () => queue,
  useJotformSubmissionAction: () => act,
}))

const NEEDS = {
  submission_id: '6600000000000000011',
  session_cm_id: 1000002,
  submitted_name: 'Pat Doe',
  nametag: 'Patty',
  submitted_at: '2026-08-31 09:00:00',
  match_status: 'unmatched',
  suggestions: [],
  write_in_suggestion: 'u_cedar/Patty Doe',
}

beforeEach(() => {
  act.mutate.mockReset()
  queue.data = {
    year: 2026,
    unmatched: [NEEDS],
    resolved: [],
    cancelled: [
      {
        submission_id: '6600000000000000012',
        session_cm_id: 1000002,
        submitted_name: 'Liam Garcia',
        submitted_at: '2026-08-30 09:00:00',
        match_status: 'cancelled',
        registration_status: 'cancelled',
      },
      {
        submission_id: '6600000000000000013',
        session_cm_id: 1000002,
        submitted_name: 'Riley Sam',
        submitted_at: '2026-08-30 10:00:00',
        match_status: 'cancelled',
        registration_status: 'incomplete',
      },
    ],
    write_ins: [
      {
        submission_id: '6600000000000000014',
        session_cm_id: 1000002,
        submitted_name: 'Olivia Chen',
        submitted_at: '2026-08-29 09:00:00',
        match_status: 'write_in',
        write_in_name: 'Liv C.',
        write_in_unit: 'Fern 1',
      },
    ],
    write_in_options: [
      {
        option_id: 'u_fern/Kitchen crew',
        session_cm_id: 1000002,
        unit_id: 'u_fern',
        unit_name: 'Fern 1',
        occupant_name: 'Kitchen crew',
      },
      {
        option_id: 'u_cedar/Patty Doe',
        session_cm_id: 1000002,
        unit_id: 'u_cedar',
        unit_name: 'Cedar 3',
        occupant_name: 'Patty Doe',
      },
      {
        option_id: 'u_oak/Samuel Johnson',
        session_cm_id: 1000003,
        unit_id: 'u_oak',
        unit_name: 'Oak 2',
        occupant_name: 'Samuel Johnson',
      },
    ],
    duplicates: [],
    guests: [],
  }
})

describe('JotformQueue — write-ins', () => {
  it("offers this weekend's write-ins, pre-selected, and links the chosen one", () => {
    render(<JotformQueue year={2026} sessionCmId={1000002} />)
    const item = screen.getByTestId('jotform-unmatched-6600000000000000011')
    const select = within(item).getByRole('combobox', { name: 'Write-in for Pat Doe' })
    expect((select as HTMLSelectElement).value).toBe('u_cedar/Patty Doe')
    const labels = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(labels).toEqual(['Choose a write-in…', 'Kitchen crew · Fern 1', 'Patty Doe · Cedar 3'])

    fireEvent.click(within(item).getByRole('button', { name: 'Link chosen write-in' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'write_in',
      submissionId: '6600000000000000011',
      unitId: 'u_cedar',
      occupantName: 'Patty Doe',
    })

    fireEvent.change(select, { target: { value: 'u_fern/Kitchen crew' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Link chosen write-in' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'write_in',
      submissionId: '6600000000000000011',
      unitId: 'u_fern',
      occupantName: 'Kitchen crew',
    })
  })

  it('offers no write-in control on a weekend with no write-ins', () => {
    const data = queue.data as { write_in_options: unknown[] }
    data.write_in_options = []
    const { container } = render(<JotformQueue year={2026} sessionCmId={1000002} />)
    const item = within(container).getByTestId('jotform-unmatched-6600000000000000011')
    expect(within(item).queryByRole('combobox', { name: /^Write-in for/ })).not.toBeInTheDocument()
    expect(
      within(item).queryByRole('button', { name: 'Link chosen write-in' })
    ).not.toBeInTheDocument()
  })

  it('lists linked write-ins with the name staff gave the write-in, and unlinks', () => {
    render(<JotformQueue year={2026} sessionCmId={1000002} />)
    const list = screen.getByTestId('jotform-write-ins')
    expect(list).toHaveTextContent('Write-ins (1)')
    expect(list).toHaveTextContent('Olivia Chen')
    expect(list).toHaveTextContent('→ Liv C. · Fern 1')
    fireEvent.click(within(list).getByRole('button', { name: 'Unlink Olivia Chen' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'unlink',
      submissionId: '6600000000000000014',
    })
  })
})

describe('JotformQueue — cancelled registrations', () => {
  it('lists them apart with their status and asks nothing of staff', () => {
    render(<JotformQueue year={2026} sessionCmId={1000002} />)
    const list = screen.getByTestId('jotform-cancelled')
    expect(list).toHaveTextContent('Cancelled registrations (2)')
    expect(list).toHaveTextContent('Liam Garcia')
    expect(list).toHaveTextContent('→ cancelled')
    expect(list).toHaveTextContent('→ incomplete')
    expect(within(list).queryByRole('button')).not.toBeInTheDocument()
    // Not needing a guest.
    expect(screen.queryByTestId('jotform-unmatched-6600000000000000012')).not.toBeInTheDocument()
  })
})
