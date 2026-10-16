/**
 * Add a Request… (the form-intake mock's steps 3, 4, 10–13): the kit's EditorForm, pre-filled from the row, its
 * Session picker limited to the gap sessions (held ones switched off), Q5-A's Round 1 checkbox ticked on a session
 * CampMinder already paid, the effects on the money, and one amber problem beside the buttons once a save is tried.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { AddRequestEditor } from './AddRequestEditor'
import { EMMA, OKAFOR_HH, RILEY, SESSIONS, S3, TWR } from './intakeFixtures'
import { CS_EDITOR, CS_EDITOR_ON_WHITE } from '../kit/csType'
import { sessionIndex, targetFromRow } from './intakeModel'

vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../../../hooks/camperships/useAidProgramNames', () => ({
  useAidProgramPool: () => (program: string) => (program === 'summer' ? 'Camp & Quest' : null),
}))

const names = sessionIndex(SESSIONS)
/** The kit's Effects lines, one per effect. */
const effectLines = () => [...document.querySelectorAll<HTMLElement>('[data-effect]')]
let fetchSpy: MockInstance<typeof fetch>
let answer: () => Response

beforeEach(() => {
  answer = () =>
    new Response(JSON.stringify({ addition: { id: 'add1' }, request: { id: 'req1' } }), {
      status: 201,
    })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(answer()))
})
afterEach(() => fetchSpy.mockRestore())

function renderEditor(
  row = EMMA,
  extra: { onSaved?: () => void; onCancel?: () => void; onWhite?: boolean } = {}
) {
  const onSaved = extra.onSaved ?? vi.fn()
  const onCancel = extra.onCancel ?? vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AddRequestEditor
        target={targetFromRow(row)}
        names={names}
        onSaved={onSaved}
        onCancel={onCancel}
        onWhite={extra.onWhite ?? false}
      />
    </QueryClientProvider>
  )
  return { onSaved, onCancel }
}

const posted = () => fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')
const bodyOf = (i = 0) => JSON.parse(posted()[i]![1]!.body as string) as Record<string, unknown>

describe('Add a Request…', () => {
  it('pre-fills a registration-ask row: its gap session, its ask, and says where the ask came from', () => {
    renderEditor()
    expect(screen.getByText('Add a Request · Emma Johnson')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Session/ })).toHaveTextContent('Teen Winter Retreat')
    expect(screen.getByLabelText('Ask')).toHaveValue('290')
    expect(screen.getByText('registration ask')).toBeInTheDocument()
    // No CampMinder money on TWR: no Round 1 checkbox.
    expect(screen.queryByRole('checkbox')).toBeNull()
    const effects = effectLines()
    expect(effects[0]).toHaveTextContent('Makes a TWR request, asking $290')
    expect(effects[0]).toHaveTextContent('→ Needs an offer, Round 1')
  })

  it('lists only the gap sessions, with a held session shown switched off under Already held', async () => {
    renderEditor()
    await userEvent.click(screen.getByRole('button', { name: /Session/ }))
    expect(screen.getByRole('option', { name: /Teen Winter Retreat/ })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByText('Already held')).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: /Teen Leadership Institute · holds a request/ })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('offers CampMinder’s posted amount as Round 1, ticked, and says what each choice does (Q5-A)', async () => {
    renderEditor(RILEY)
    expect(screen.getByRole('button', { name: /Session/ })).toHaveTextContent(
      'Session 3 · CampMinder aid here'
    )
    expect(screen.getByLabelText('Ask')).toHaveValue('2500')
    const box = screen.getByRole('checkbox', {
      // The kit's caption ("Round 1") and the sentence both label the box.
      name: /Record CampMinder's \$2,258 as Round 1, posted \(Feb 20\)$/,
    })
    expect(box).toBeChecked()
    const first = () => effectLines()[0]!
    expect(first()).toHaveTextContent('→ Round 1 $2,258, posted: the money counts in Camp & Quest')
    // No aid form at all: a blank application is made.
    expect(screen.getByText('No aid form: a blank application is made')).toBeInTheDocument()
    await userEvent.click(box)
    expect(first()).toHaveTextContent(
      "→ Needs an offer, Round 1; CampMinder's $2,258 counts once Round 1 is decided"
    )
  })

  it('sends Round 1 when ticked, and the request only when unticked', async () => {
    renderEditor(RILEY)
    await userEvent.type(screen.getByLabelText('Reason'), 'Assessed by phone')
    await userEvent.click(screen.getByRole('button', { name: 'Add Request' }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]![0]).toBe('/api/financial-aid/requests/2027/additions')
    expect(bodyOf()).toEqual({
      household_cm_id: 1000004,
      person_cm_id: 1000041,
      session_cm_id: S3,
      ask: 2500,
      reason: 'Assessed by phone',
      round1_campminder: 2258,
    })
  })

  it('sends no Round 1 when the box is unticked', async () => {
    renderEditor(RILEY)
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.type(screen.getByLabelText('Reason'), 'Assessed by phone')
    await userEvent.click(screen.getByRole('button', { name: 'Add Request' }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(bodyOf()['round1_campminder']).toBeNull()
  })

  it('shows no problem until a save is tried, then one amber problem beside the buttons', async () => {
    renderEditor()
    expect(screen.queryByText('Reason is required')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Add Request' }))
    expect(screen.getByText('Reason is required')).toBeInTheDocument()
    expect(posted()).toHaveLength(0)
    // It follows the typing once tried.
    const ask = screen.getByLabelText('Ask')
    await userEvent.clear(ask)
    await userEvent.type(ask, '0')
    await userEvent.type(screen.getByLabelText('Reason'), 'Asked at registration')
    expect(screen.getByText('The ask must be above $0')).toBeInTheDocument()
    expect(screen.queryByText('Reason is required')).toBeNull()
  })

  it("shows the server's refusal beside the buttons, and keeps what was typed", async () => {
    answer = () =>
      new Response(
        JSON.stringify({
          detail: 'CampMinder shows $2,258 on no request for that family and session, not $2,000',
        }),
        { status: 422 }
      )
    renderEditor(RILEY)
    await userEvent.type(screen.getByLabelText('Reason'), 'Assessed by phone')
    await userEvent.click(screen.getByRole('button', { name: 'Add Request' }))
    expect(
      await screen.findByText(
        'CampMinder shows $2,258 on no request for that family and session, not $2,000'
      )
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toHaveValue('Assessed by phone')
  })

  it('saves on Enter and hands the page the status words', async () => {
    const { onSaved } = renderEditor()
    await userEvent.type(screen.getByLabelText('Reason'), 'Asked at TWR registration{Enter}')
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith('✓ Added a TWR request for Emma Johnson · ask $290')
    )
    expect(bodyOf()).toMatchObject({ session_cm_id: TWR, ask: 290, round1_campminder: null })
  })

  it('goes back on Cancel and on Esc', async () => {
    const { onCancel } = renderEditor()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByLabelText('Reason'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('makes a household request on a Family Camp row, its picker the household’s weekends', async () => {
    renderEditor(OKAFOR_HH)
    expect(
      screen.getByText('Add a Household Request · ⌂ Daniel & Priya Chen-Okafor')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Session/ }))
    const list = screen.getByRole('listbox')
    expect(within(list).getByText('Family Camp weekends, no request')).toBeInTheDocument()
    expect(within(list).getAllByRole('option')).toHaveLength(2)
  })

  it('is the white card on a row’s cream, and band-tinted inside a white card (green on white)', () => {
    renderEditor()
    const card = () => screen.getByTestId('aid-editor-form').parentElement as HTMLElement
    expect(card().className).toBe(CS_EDITOR)
    cleanup()
    renderEditor(EMMA, { onWhite: true })
    expect(card().className).toBe(CS_EDITOR_ON_WHITE)
  })
})
