/** Session capacity on the Rules tab (spec §6.3; Decision 23): finance enters one session at a time. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CapacityForm } from './CapacityForm'

vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
let names: Map<number, string> | undefined
vi.mock('../../../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: () => names,
}))
let granted: string[] = []
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
let stored: Array<{
  year: number
  session_cm_id: number
  capacity: number
  note: string
  actor: string
}> = []
const sent: unknown[] = []
let pending = false
let readError: Error | null = null
let saveError: Error | null = null
let resets = 0
vi.mock('../../../../hooks/camperships/useAidCapacity', () => ({
  useAidSessionCapacities: () => ({
    data: { year: 2027, sessions: stored },
    isLoading: false,
    error: readError,
  }),
  useAidSetCapacity: () => ({
    isPending: pending,
    error: saveError,
    reset: () => {
      resets += 1
      saveError = null
    },
    mutate: (
      vars: { sessionCmId: number; body: { capacity: number; note: string } },
      handlers: { onSuccess: (out: unknown) => void }
    ) => {
      sent.push(vars)
      handlers.onSuccess({
        year: 2027,
        session_cm_id: vars.sessionCmId,
        capacity: vars.body.capacity,
        note: vars.body.note,
        actor: 'Test User',
      })
    },
  }),
}))

beforeEach(() => {
  sent.length = 0
  granted = ['financial_aid.view', 'financial_aid.rules']
  stored = []
  pending = false
  readError = null
  saveError = null
  resets = 0
  names = new Map([
    [1000101, 'Session 1'],
    [1000102, 'Session 2'],
  ])
})

describe('CapacityForm', () => {
  it("sets a session's capacity with a note, and says what it saved", async () => {
    render(<CapacityForm />)
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 2')
    await userEvent.type(screen.getByRole('textbox', { name: 'Capacity (places)' }), '120')
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Note (optional)' }),
      'Two cabins closed'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(sent).toEqual([
      { sessionCmId: 1000102, body: { capacity: 120, note: 'Two cabins closed' } },
    ])
    expect(screen.getByTestId('capacity-saved')).toHaveTextContent(
      'Saved: Session 2 holds 120 places in 2027 · Two cabins closed'
    )
  })

  it('writes a four-figure capacity with its thousands separator, saved and stored', async () => {
    stored = [{ year: 2027, session_cm_id: 1000101, capacity: 1200, note: '', actor: 'A' }]
    render(<CapacityForm />)
    expect(screen.getByTestId('capacity-stored')).toHaveTextContent('Session 1 · 1,200 places')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 2')
    await userEvent.type(screen.getByRole('textbox', { name: 'Capacity (places)' }), '1200')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByTestId('capacity-saved')).toHaveTextContent(
      'Saved: Session 2 holds 1,200 places in 2027'
    )
  })

  it("won't send a figure it can't read", async () => {
    render(<CapacityForm />)
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 1')
    await userEvent.type(screen.getByRole('textbox', { name: 'Capacity (places)' }), '12.5')
    expect(screen.getByText('A whole number of places')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('prefills the stored capacity and note when a session is chosen, and lists what is stored', async () => {
    stored = [
      { year: 2027, session_cm_id: 1000102, capacity: 96, note: 'Cabin 4 closed', actor: 'A' },
    ]
    render(<CapacityForm />)
    expect(within(screen.getByTestId('capacity-stored')).getByText(/Session 2/)).toHaveTextContent(
      'Session 2 · 96 places · Cabin 4 closed'
    )
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 2')
    expect(screen.getByRole('textbox', { name: 'Capacity (places)' })).toHaveValue('96')
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue('Cabin 4 closed')
    // Saving the prefilled figure sends it as it stands.
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(sent).toEqual([{ sessionCmId: 1000102, body: { capacity: 96, note: 'Cabin 4 closed' } }])
  })

  it('keeps what the person typed over the stored figure, and clearing a field is theirs', async () => {
    stored = [{ year: 2027, session_cm_id: 1000102, capacity: 96, note: 'x', actor: 'A' }]
    render(<CapacityForm />)
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 2')
    await userEvent.clear(screen.getByRole('textbox', { name: 'Note (optional)' }))
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue('')
    await userEvent.clear(screen.getByRole('textbox', { name: 'Capacity (places)' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows view-only readers what is stored, read only: no inputs, no Save', () => {
    granted = ['financial_aid.view']
    stored = [{ year: 2027, session_cm_id: 1000101, capacity: 80, note: '', actor: 'A' }]
    render(<CapacityForm />)
    expect(screen.getByTestId('capacity-stored')).toHaveTextContent('Session 1 · 80 places')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('clears a refusal when another session is chosen', async () => {
    saveError = new Error('No such session in that season')
    render(<CapacityForm />)
    expect(screen.getByText('No such session in that season')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 2')
    expect(resets).toBe(1)
  })

  it("shows the server's words on a refusal", () => {
    saveError = new Error('Capacity must be 5,000 or less')
    render(<CapacityForm />)
    expect(screen.getByText('Capacity must be 5,000 or less')).toBeInTheDocument()
  })

  it('shows Saving… and disables Save while the save is in flight', async () => {
    stored = [{ year: 2027, session_cm_id: 1000102, capacity: 96, note: '', actor: 'A' }]
    pending = true
    render(<CapacityForm />)
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 2')
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })

  it("replaces what was typed with the chosen session's stored figure and note", async () => {
    stored = [{ year: 2027, session_cm_id: 1000102, capacity: 96, note: 'Cabin 4', actor: 'A' }]
    render(<CapacityForm />)
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 1')
    await userEvent.type(screen.getByRole('textbox', { name: 'Capacity (places)' }), '50')
    await userEvent.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'mine')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 2')
    expect(screen.getByRole('textbox', { name: 'Capacity (places)' })).toHaveValue('96')
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue('Cabin 4')
    // And back to a session with nothing stored: blank, not the other session's figure.
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 1')
    expect(screen.getByRole('textbox', { name: 'Capacity (places)' })).toHaveValue('')
  })

  it('keeps a figure typed before the first pick when the chosen session has nothing stored', async () => {
    render(<CapacityForm />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Capacity (places)' }), '75')
    await userEvent.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'early')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Session 1')
    expect(screen.getByRole('textbox', { name: 'Capacity (places)' })).toHaveValue('75')
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue('early')
  })

  it("lists what is stored in the picker's order, and only once the names are in", () => {
    stored = [
      { year: 2027, session_cm_id: 1000102, capacity: 2, note: '', actor: 'A' },
      { year: 2027, session_cm_id: 1000101, capacity: 1, note: '', actor: 'A' },
    ]
    names = undefined
    const { rerender } = render(<CapacityForm />)
    expect(screen.queryByTestId('capacity-stored')).not.toBeInTheDocument()
    expect(screen.getByText(/Loading sessions|Couldn.t load the sessions/)).toBeInTheDocument()
    names = new Map([
      [1000101, 'Session 1'],
      [1000102, 'Session 2'],
    ])
    rerender(<CapacityForm />)
    const rows = within(screen.getByTestId('capacity-stored')).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['Session 1 · 1 places', 'Session 2 · 2 places'])
  })

  it('says so when the stored list could not be refreshed, and not otherwise', () => {
    stored = [{ year: 2027, session_cm_id: 1000101, capacity: 80, note: '', actor: 'A' }]
    const { unmount } = render(<CapacityForm />)
    expect(screen.queryByText(/Couldn.t refresh this list/)).not.toBeInTheDocument()
    unmount()
    readError = new Error('boom')
    render(<CapacityForm />)
    expect(screen.getByText(/Couldn.t refresh this list/)).toBeInTheDocument()
    expect(screen.getByTestId('capacity-stored')).toHaveTextContent('Session 1 · 80 places')
  })
})

it('shows the registrar the stored list, no form (owner 10-06, open item 3)', () => {
  granted = ['financial_aid.view', 'financial_aid.casework']
  stored = [{ year: 2027, session_cm_id: 1000101, capacity: 80, note: '', actor: 'A' }]
  render(<CapacityForm />)
  expect(screen.getByText('Not part of the rules')).toBeInTheDocument()
  expect(
    screen.getByText(
      "Reference only: a Round 3 request shows its session's capacity beside its enrollment. Nothing prices from it."
    )
  ).toBeInTheDocument()
  expect(screen.getByTestId('capacity-stored')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  expect(screen.queryByText(/Choosing a session shows what is stored/)).toBeNull()
})
