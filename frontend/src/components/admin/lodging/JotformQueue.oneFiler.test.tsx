/**
 * One filer, one decision (kindred#2839 follow-up): a link, ignore, unlink or
 * restore also moves the same filer's other filings of the weekend, and the
 * server names them. The tab says so in one plain line, and says nothing when
 * the action moved only the filing clicked. The hooks are mocked; the hook's
 * hand-off of the server's answer is pinned in `useJotformAdmin.test.tsx`.
 * Fictional names only.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JotformActionOutcome } from '../../../hooks/useJotformAdmin'
import { JotformQueue } from './JotformQueue'

type OnDone = (outcome: JotformActionOutcome) => void

let answer: JotformActionOutcome = null
const onDones: OnDone[] = []
const act = {
  mutate: vi.fn(() => {
    for (const onDone of onDones) onDone(answer)
  }),
  isPending: false,
}
const queue = { data: undefined as unknown, isLoading: false, error: null as Error | null }
vi.mock('../../../hooks/useJotformAdmin', () => ({
  useJotformWeekendQueue: () => queue,
  useJotformSubmissionAction: (onDone?: OnDone) => {
    if (onDone !== undefined) onDones.push(onDone)
    return act
  },
}))

beforeEach(() => {
  onDones.length = 0
  act.mutate.mockClear()
  answer = null
  queue.data = {
    year: 2026,
    unmatched: [
      {
        submission_id: '6600000000000000001',
        session_cm_id: 1000002,
        submitted_name: 'Emma Johnson',
        submitted_at: '2026-08-31 09:00:00',
        match_status: 'unmatched',
      },
    ],
    resolved: [
      {
        submission_id: '6600000000000000005',
        session_cm_id: 1000002,
        submitted_name: 'Olivia Chen',
        submitted_at: '2026-08-12 09:00:00',
        match_status: 'ignored',
      },
    ],
    guests: [],
  }
})

function renderQueue() {
  return render(<JotformQueue year={2026} sessionCmId={1000002} scenario="" />)
}

describe('the line after a staff action', () => {
  it("names the filer's other filing the action also moved", () => {
    answer = {
      action: 'ignored',
      also: [
        {
          submission_id: '6600000000000000002',
          submitted_name: 'Emma Johnson',
          submitted_at: '2026-08-09 09:00:00',
        },
      ],
    }
    renderQueue()
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }))
    expect(screen.getByText("Also ignored Emma Johnson's other filing (Aug 9)")).toBeInTheDocument()
  })

  it('names every other filing, and a restore as a restore', () => {
    answer = {
      action: 'restored',
      also: [
        {
          submission_id: '6600000000000000006',
          submitted_name: 'Olivia Chen',
          submitted_at: '2026-08-09 09:00:00',
        },
        {
          submission_id: '6600000000000000007',
          submitted_name: 'olivia chen',
          submitted_at: '2026-08-14 09:00:00',
        },
      ],
    }
    renderQueue()
    fireEvent.click(screen.getByRole('button', { name: 'Restore Olivia Chen' }))
    expect(
      screen.getByText("Also restored Olivia Chen's other filings (Aug 9, Aug 14)")
    ).toBeInTheDocument()
  })

  it('says nothing when only the clicked filing moved, clearing an earlier line', () => {
    answer = {
      action: 'ignored',
      also: [
        {
          submission_id: '6600000000000000002',
          submitted_name: 'Emma Johnson',
          submitted_at: '2026-08-09 09:00:00',
        },
      ],
    }
    renderQueue()
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }))
    expect(screen.getByText(/^Also ignored/)).toBeInTheDocument()

    answer = null
    fireEvent.click(screen.getByRole('button', { name: 'Restore Olivia Chen' }))
    expect(screen.queryByText(/^Also /)).not.toBeInTheDocument()
  })
})
