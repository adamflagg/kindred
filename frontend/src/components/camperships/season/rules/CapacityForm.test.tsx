/** Session capacity on the Rules tab (spec §6.3; Decision 23): finance enters one session at a time. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CapacityForm } from './CapacityForm'

vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../../../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: () =>
    new Map([
      [1000101, 'Session 1'],
      [1000102, 'Session 2'],
    ]),
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
vi.mock('../../../../hooks/camperships/useAidCapacity', () => ({
  useAidSessionCapacities: () => ({
    data: { year: 2027, sessions: stored },
    isLoading: false,
    error: null,
  }),
  useAidSetCapacity: () => ({
    isPending: false,
    error: null,
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

  it("won't send a figure it can't read, and says saving replaces what was stored", async () => {
    render(<CapacityForm />)
    expect(screen.getByText(/saving replaces it/)).toBeInTheDocument()
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
})
