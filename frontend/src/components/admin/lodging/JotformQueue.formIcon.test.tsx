/**
 * The Requests tab's two pickers mark what already has a Jotform form with one
 * icon (kindred#2839 owner ask, 2026-09-25): a guest who has filed, and a board
 * write-in already linked to a filing -- with the filer's name beside it. The
 * icon replaced the "(has a submission)" text, which made the guest list hard
 * to read. Both pickers are Headless UI listboxes now, since a native <option>
 * cannot hold an icon.
 *
 * A linked write-in stays selectable: a party can share one. The hooks are
 * mocked. Fictional names only.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JotformQueue } from './JotformQueue'

const act = { mutate: vi.fn(), isPending: false }
const queue = { data: undefined as unknown, isLoading: false, error: null as Error | null }
vi.mock('../../../hooks/useJotformAdmin', () => ({
  useJotformWeekendQueue: () => queue,
  useJotformSubmissionAction: () => act,
}))

const SESSION = 1000002
const ROW = '6600000000000000031'

function option(unitId: string, name: string, unitName: string, linkedFilers: string[] = []) {
  return {
    option_id: `${unitId}/${name}`,
    session_cm_id: SESSION,
    unit_id: unitId,
    unit_name: unitName,
    occupant_name: name,
    linked_filers: linkedFilers,
  }
}

beforeEach(() => {
  act.mutate.mockReset()
  queue.data = {
    year: 2026,
    session_cm_id: SESSION,
    unmatched: [
      {
        submission_id: ROW,
        session_cm_id: SESSION,
        submitted_name: 'Emma Johnson',
        submitted_at: '2026-08-31 09:00:00',
        match_status: 'unmatched',
        suggestions: [],
        write_in_suggestion: 'u_fern/Kitchen crew',
      },
    ],
    resolved: [],
    write_in_options: [
      option('u_elm', 'Liv C.', 'Elm 1', ['Olivia Chen']),
      option('u_fern', 'Kitchen crew', 'Fern 1'),
      // Linked to this row's own filer's other filing.
      option('u_oak', 'Emmy J.', 'Oak 2', ['Emma Johnson']),
    ],
    duplicates: [],
    guests: [
      {
        person_cm_id: 1000006,
        display_name: 'Liam Garcia',
        session_cm_id: SESSION,
        has_submission: true,
      },
      {
        person_cm_id: 1000007,
        display_name: 'Samuel Johnson',
        session_cm_id: SESSION,
        has_submission: false,
      },
    ],
  }
})

function row() {
  render(<JotformQueue year={2026} sessionCmId={SESSION} scenario="" />)
  return screen.getByTestId(`jotform-unmatched-${ROW}`)
}

async function open(item: HTMLElement, name: string) {
  await userEvent.click(within(item).getByRole('button', { name }))
  return screen.getByRole('listbox')
}

describe('the guest picker', () => {
  it('marks a guest who has filed with the icon, not "(has a submission)"', async () => {
    const item = row()
    const list = await open(item, 'Guest for Emma Johnson')

    expect(list).not.toHaveTextContent('has a submission')
    const liam = within(list).getByRole('option', { name: /^Liam Garcia/ })
    expect(
      within(liam).getByRole('button', { name: 'Already has a Jotform form' })
    ).toBeInTheDocument()
    const samuel = within(list).getByRole('option', { name: /^Samuel Johnson/ })
    expect(within(samuel).queryByRole('button')).not.toBeInTheDocument()
    expect(within(list).getByRole('option', { name: 'Choose a guest…' })).toBeInTheDocument()
  })

  it('shows "Choose a guest…" until staff pick, then links the one picked', async () => {
    const item = row()
    const button = within(item).getByRole('button', { name: 'Guest for Emma Johnson' })
    expect(button).toHaveTextContent('Choose a guest…')
    expect(within(item).getByRole('button', { name: 'Link chosen guest' })).toBeDisabled()

    const list = await open(item, 'Guest for Emma Johnson')
    await userEvent.click(within(list).getByRole('option', { name: /^Samuel Johnson/ }))

    expect(button).toHaveTextContent('Samuel Johnson')
    await userEvent.click(within(item).getByRole('button', { name: 'Link chosen guest' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'link',
      submissionId: ROW,
      personCmId: 1000007,
    })
  })
})

describe('the write-in picker', () => {
  it("marks a linked write-in with the icon and its filer's name, and an unlinked one with neither", async () => {
    const item = row()
    const list = await open(item, 'Write-in for Emma Johnson')

    const liv = within(list).getByRole('option', { name: /^Liv C\. · Elm 1/ })
    expect(
      within(liv).getByRole('button', { name: "Linked to Olivia Chen's form" })
    ).toBeInTheDocument()
    expect(liv).toHaveTextContent('Olivia Chen')

    const kitchen = within(list).getByRole('option', { name: /^Kitchen crew · Fern 1/ })
    expect(within(kitchen).queryByRole('button')).not.toBeInTheDocument()
    expect(kitchen).toHaveTextContent(/^Kitchen crew · Fern 1$/)

    expect(within(list).getByRole('option', { name: 'Choose a write-in…' })).toBeInTheDocument()
  })

  it("marks a write-in linked to this row's own filer too", async () => {
    const item = row()
    const list = await open(item, 'Write-in for Emma Johnson')

    const own = within(list).getByRole('option', { name: /^Emmy J\. · Oak 2/ })
    expect(
      within(own).getByRole('button', { name: "Linked to Emma Johnson's form" })
    ).toBeInTheDocument()
  })

  it('still shows the pre-selection, and links it', async () => {
    const item = row()
    expect(
      within(item).getByRole('button', { name: 'Write-in for Emma Johnson' })
    ).toHaveTextContent('Kitchen crew · Fern 1')

    await userEvent.click(within(item).getByRole('button', { name: 'Link chosen write-in' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'write_in',
      submissionId: ROW,
      unitId: 'u_fern',
      occupantName: 'Kitchen crew',
    })
  })

  it('links a linked write-in picked from the list: a party can share one', async () => {
    const item = row()
    const list = await open(item, 'Write-in for Emma Johnson')
    await userEvent.click(within(list).getByRole('option', { name: /^Liv C\. · Elm 1/ }))

    expect(
      within(item).getByRole('button', { name: 'Write-in for Emma Johnson' })
    ).toHaveTextContent('Liv C. · Elm 1')
    await userEvent.click(within(item).getByRole('button', { name: 'Link chosen write-in' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'write_in',
      submissionId: ROW,
      unitId: 'u_elm',
      occupantName: 'Liv C.',
    })
  })
})
