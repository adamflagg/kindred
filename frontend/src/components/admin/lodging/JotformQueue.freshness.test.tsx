/**
 * The Requests tab stays mounted under `Activity` (kindred#2839 owner report,
 * 2026-09-25), so state it seeds once goes stale when the queue refetches
 * behind it:
 *
 *  - a filing's write-in pre-selection follows the server's current
 *    `write_in_suggestion` until staff pick one themselves; a pick survives a
 *    refetch, is dropped when its write-in is gone, and does not cross a
 *    scenario switch;
 *  - the "Also …" line after an action belongs to the weekend and scenario it
 *    was made in, and does not follow staff to another.
 *
 * The hooks are mocked; the page-level refetch itself is pinned in
 * `pages/WeekendRosterPage.requestsRefresh.test.tsx`. Fictional names only.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
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

const SESSION = 1000002

const FILING = {
  submission_id: '6600000000000000021',
  session_cm_id: SESSION,
  submitted_name: 'Miriam Garcia',
  nametag: 'Mimi',
  submitted_at: '2026-08-31 09:00:00',
  match_status: 'unmatched',
  suggestions: [],
}

function option(unitId: string, name: string, unitName = 'Cedar 1') {
  return {
    option_id: `${unitId}/${name}`,
    session_cm_id: SESSION,
    unit_id: unitId,
    unit_name: unitName,
    occupant_name: name,
  }
}

const KITCHEN = option('u_fern', 'Kitchen crew', 'Fern 1')
const MINI = option('u_cedar', 'Mini')
const MIMI = option('u_cedar', 'Mimi')

function queueOf(options: Array<ReturnType<typeof option>>, suggestion: string) {
  return {
    year: 2026,
    session_cm_id: SESSION,
    unmatched: [{ ...FILING, write_in_suggestion: suggestion }],
    resolved: [
      {
        submission_id: '6600000000000000025',
        session_cm_id: SESSION,
        submitted_name: 'Olivia Chen',
        submitted_at: '2026-08-12 09:00:00',
        match_status: 'ignored',
      },
    ],
    write_in_options: options,
    duplicates: [],
    guests: [],
  }
}

function page(scenario = '', sessionCmId = SESSION) {
  return <JotformQueue year={2026} sessionCmId={sessionCmId} scenario={scenario} />
}

function select(): HTMLSelectElement {
  const item = screen.getByTestId(`jotform-unmatched-${FILING.submission_id}`)
  return within(item).getByRole<HTMLSelectElement>('combobox', {
    name: 'Write-in for Miriam Garcia',
  })
}

beforeEach(() => {
  onDones.length = 0
  act.mutate.mockClear()
  answer = null
  queue.data = queueOf([KITCHEN, MINI], '')
})

describe('the write-in pre-selection follows the refetched queue', () => {
  it('pre-selects a suggestion that arrives after the row mounted', () => {
    const { rerender } = render(page())
    expect(select().value).toBe('')

    // Staff write "Mimi" on the board; the queue refetches behind the tab.
    queue.data = queueOf([KITCHEN, MINI, MIMI], MIMI.option_id)
    rerender(page())

    expect(select().value).toBe(MIMI.option_id)
    fireEvent.click(screen.getByRole('button', { name: 'Link chosen write-in' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'write_in',
      submissionId: FILING.submission_id,
      unitId: 'u_cedar',
      occupantName: 'Mimi',
    })
  })

  it('follows the suggestion when it goes away again', () => {
    queue.data = queueOf([KITCHEN, MIMI], MIMI.option_id)
    const { rerender } = render(page())
    expect(select().value).toBe(MIMI.option_id)

    queue.data = queueOf([KITCHEN], '')
    rerender(page())
    expect(select().value).toBe('')
  })

  it("keeps staff's own pick across a refetch that changes the suggestion", () => {
    const { rerender } = render(page())
    fireEvent.change(select(), { target: { value: KITCHEN.option_id } })

    queue.data = queueOf([KITCHEN, MINI, MIMI], MIMI.option_id)
    rerender(page())

    expect(select().value).toBe(KITCHEN.option_id)
  })

  it('keeps an explicit "Choose a write-in…" too', () => {
    queue.data = queueOf([KITCHEN, MIMI], MIMI.option_id)
    const { rerender } = render(page())
    fireEvent.change(select(), { target: { value: '' } })

    queue.data = queueOf([KITCHEN, MINI, MIMI], MIMI.option_id)
    rerender(page())

    expect(select().value).toBe('')
  })

  it("drops staff's pick once its write-in is gone, back to the suggestion", () => {
    const { rerender } = render(page())
    fireEvent.change(select(), { target: { value: MINI.option_id } })
    expect(select().value).toBe(MINI.option_id)

    // "Mini" is removed from the board and "Mimi" written in its place.
    queue.data = queueOf([KITCHEN, MIMI], MIMI.option_id)
    rerender(page())
    expect(select().value).toBe(MIMI.option_id)

    // And it stays dropped: the write-in coming back does not revive the pick.
    queue.data = queueOf([KITCHEN, MINI, MIMI], MIMI.option_id)
    rerender(page())
    expect(select().value).toBe(MIMI.option_id)
  })

  it("does not carry staff's pick into another scenario", () => {
    const { rerender } = render(page('scn_a'))
    fireEvent.change(select(), { target: { value: KITCHEN.option_id } })

    queue.data = queueOf([KITCHEN, MIMI], MIMI.option_id)
    rerender(page('scn_b'))

    expect(select().value).toBe(MIMI.option_id)
  })
})

describe('the "Also …" line belongs to where the action was taken', () => {
  const ALSO: JotformActionOutcome = {
    action: 'ignored',
    also: [
      {
        submission_id: '6600000000000000022',
        submitted_name: 'Miriam Garcia',
        submitted_at: '2026-08-09 09:00:00',
      },
    ],
  }

  it('is cleared by a scenario switch, and does not come back on switching back', () => {
    answer = ALSO
    const { rerender } = render(page(''))
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }))
    expect(screen.getByText(/^Also ignored Miriam Garcia/)).toBeInTheDocument()

    rerender(page('scn_b'))
    expect(screen.queryByText(/^Also /)).not.toBeInTheDocument()

    rerender(page(''))
    expect(screen.queryByText(/^Also /)).not.toBeInTheDocument()
  })

  it('is cleared by a weekend switch', () => {
    answer = ALSO
    const { rerender } = render(page(''))
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }))
    expect(screen.getByText(/^Also ignored Miriam Garcia/)).toBeInTheDocument()

    rerender(page('', 1000003))
    expect(screen.queryByText(/^Also /)).not.toBeInTheDocument()
  })
})
