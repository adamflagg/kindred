/**
 * Requests › Form intake (PR 3; spec 71 §2.4; the form-intake mock, walkthrough steps 7–14): its band, the three
 * filters held in the URL with their counts, the cells, the row actions (Add a Request…, Mark Reviewed) for casework,
 * a row kept in view after its action, Find a Camper Not Listed…, the grants line and the notes. The network is
 * stubbed at fetch; `useApiWithAuth` is real.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  AVA,
  EMMA,
  RILEY,
  ROWS_2027,
  SESSIONS,
  formsRead,
  intakeRow,
  S1,
  became,
  TWR,
} from '../../components/camperships/intake/intakeFixtures'
import type { FormIntakeRowOut } from '../../components/camperships/intake/intakeTypes'
import AidFormIntakePage from './AidFormIntakePage'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../../hooks/camperships/useAidProgramNames', () => ({
  useAidProgramNames: () => ({ summer: 'At Camp', twr: 'Teen Programs', tbm: 'TBM' }),
  useAidProgramPool: () => () => null,
}))

const NOTES = {
  surface: 'requests-form-intake',
  notes: [
    {
      n: 1,
      key: 'intake_form_asked',
      term: 'Form asked',
      text: "Form asked: the aid form's program answers.",
    },
    {
      n: 2,
      key: 'intake_became',
      term: 'Became',
      text: 'Became: each request the dashboard made.',
    },
    {
      n: 3,
      key: 'intake_campminder_aid',
      term: 'CampMinder aid',
      text: 'CampMinder aid: camp aid CampMinder posted.',
    },
    {
      n: 4,
      key: 'intake_needs_a_look',
      term: 'Needs a look',
      text: 'Needs a look: what needs staff.',
    },
  ],
}

let forms = formsRead()
let unlisted: { year: number; rows: FormIntakeRowOut[]; sessions: typeof SESSIONS } = {
  year: 2027,
  rows: [],
  sessions: SESSIONS,
}
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  granted = ['financial_aid.view', 'financial_aid.casework']
  forms = formsRead()
  unlisted = { year: 2027, rows: [], sessions: SESSIONS }
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const path = String(url)
    if (init?.method === 'POST') return Promise.resolve(json({ addition: {}, request: {} }, 201))
    if (path.includes('/intake/2027/forms')) return Promise.resolve(json(forms))
    if (path.includes('/intake/2027/unlisted')) return Promise.resolve(json(unlisted))
    if (path.includes('/definitions')) return Promise.resolve(json(NOTES))
    return Promise.resolve(json({ detail: 'not here' }, 404))
  })
})
afterEach(() => fetchSpy.mockRestore())

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path = '/aid/requests/intake?year=2027') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/aid/requests/intake" element={<AidFormIntakePage />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const names = () =>
  [...document.querySelectorAll('tbody tr[data-row-key]')].map((tr) =>
    tr.getAttribute('data-row-key')
  )
const posts = () => fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')
const formsReads = () =>
  fetchSpy.mock.calls.filter(([url]) => String(url).includes('/forms')).length

describe('Requests › Form intake', () => {
  it('draws its own band, under Requests, with a way back', async () => {
    renderAt()
    expect(screen.getByRole('heading', { name: /Form intake/ })).toBeInTheDocument()
    expect(screen.getByText(/Requests · Season 2027/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '‹ Requests' })).toHaveAttribute(
      'href',
      '/aid/requests?year=2027'
    )
    await screen.findByText('Emma Johnson')
  })

  it('opens on Needs a look, each filter counting its rows', async () => {
    renderAt()
    await screen.findByText('Emma Johnson')
    expect(names()).toEqual([EMMA.key, ROWS_2027[1]!.key, RILEY.key, AVA.key, ROWS_2027[4]!.key])
    const filters = screen.getByRole('group', { name: 'Show' })
    expect(within(filters).getByRole('button', { name: 'Needs a look 5' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      within(filters).getByRole('button', { name: 'Registration ask only 2' })
    ).toBeInTheDocument()
    expect(within(filters).getByRole('button', { name: 'All forms 8' })).toBeInTheDocument()
    expect(screen.getByText('5 rows · 5 families')).toBeInTheDocument()
  })

  it('holds the filter in the URL', async () => {
    renderAt()
    await screen.findByText('Emma Johnson')
    await userEvent.click(screen.getByRole('button', { name: 'Registration ask only 2' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/requests/intake?year=2027&show=reg')
    expect(names()).toEqual([RILEY.key, ROWS_2027[5]!.key])
  })

  it("arrives from Season's line filtered to the families it counts, as a removable chip", async () => {
    renderAt('/aid/requests/intake?year=2027&show=all&cmaid=1')
    await screen.findByText('Riley Sam')
    expect(names()).toEqual([RILEY.key])
    expect(screen.getByRole('button', { name: 'All forms 1' })).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear CampMinder aid on no request' })
    )
    expect(screen.getByTestId('where')).not.toHaveTextContent('cmaid')
    expect(names()).toHaveLength(8)
  })

  it('draws the cells: a household chip, the asked words, the Became pills and marks, amber CampMinder aid', async () => {
    renderAt()
    const emma = await screen.findByText('Emma Johnson')
    expect(
      within(rowOf('Emma Johnson')).getByRole('link', { name: /Mia & Noah Johnson/ })
    ).toHaveAttribute('href', '/aid/households/1000001?year=2027')
    expect(emma.closest('a')).toHaveAttribute('href', '/aid/households/1000001?year=2027')
    expect(within(rowOf('Theodore Sam-Lindqvist')).getByText('no household')).toBeInTheDocument()
    expect(
      within(rowOf('Emma Johnson')).getByText(/At Camp: Teen Leadership Institute · \$4,000/)
    ).toBeInTheDocument()
    expect(within(rowOf('Emma Johnson')).getByText('Active')).toBeInTheDocument()
    expect(
      within(rowOf('Emma Johnson')).getByText('None for TWR: asked $290 at registration')
    ).toBeInTheDocument()
    expect(within(rowOf('Olivia Chen')).getByText('Session unclear')).toBeInTheDocument()
    expect(within(rowOf('Ava Chen-Okafor')).getByText('reg. ask · review')).toBeInTheDocument()
    const aid = within(rowOf('Riley Sam')).getByText('$2,258')
    expect(aid.className).toMatch(/amber/)
  })

  it('offers Add a Request… on a gap row and Mark Reviewed on a rule-made one, for casework only', async () => {
    renderAt()
    await screen.findByText('Emma Johnson')
    expect(
      within(rowOf('Emma Johnson')).getByRole('button', { name: 'Add a Request…' })
    ).toBeInTheDocument()
    expect(
      within(rowOf('Riley Sam')).getByRole('button', { name: 'Add a Request…' })
    ).toBeInTheDocument()
    expect(
      within(rowOf('Ava Chen-Okafor')).getByRole('button', { name: 'Mark Reviewed' })
    ).toBeInTheDocument()
    // No household: nowhere to put a request.
    expect(within(rowOf('Theodore Sam-Lindqvist')).queryByRole('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Find a Camper Not Listed…' })).toBeInTheDocument()
  })

  it('hides every action from a view-only person', async () => {
    granted = ['financial_aid.view']
    renderAt()
    await screen.findByText('Emma Johnson')
    expect(screen.queryByRole('button', { name: 'Add a Request…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark Reviewed' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Find a Camper Not Listed…' })).toBeNull()
  })

  it('opens the editor in the row, saves, refreshes, and keeps the row in view, opened, out of the count', async () => {
    renderAt()
    await screen.findByText('Emma Johnson')
    await userEvent.click(
      within(rowOf('Emma Johnson')).getByRole('button', { name: 'Add a Request…' })
    )
    expect(screen.getByText('Add a Request · Emma Johnson')).toBeInTheDocument()
    expect(screen.getByLabelText('Ask')).toHaveValue('290')
    // After the save the read says Emma no longer needs a look: her TWR request is added.
    forms = formsRead(
      ROWS_2027.map((r) =>
        r.key === EMMA.key
          ? {
              ...r,
              needs_look: false,
              look_reasons: [],
              gap_sessions: [],
              why_not: null,
              became: [
                ...(r.became ?? []),
                became({
                  request_id: 'reqemmatwr00001',
                  program_key: 'twr',
                  session_cm_id: TWR,
                  origin: 'added',
                  ask: 290,
                  addition_id: 'addemmatwr0001',
                  added_by: 'Pat Garcia',
                  added_at: '2027-03-03',
                  added_reason: 'Asked at TWR registration',
                }),
              ],
            }
          : r
      )
    )
    const before = formsReads()
    await userEvent.type(screen.getByLabelText('Reason'), 'Asked at TWR registration')
    await userEvent.click(screen.getByRole('button', { name: 'Add Request' }))
    expect(
      await screen.findByText('✓ Added a TWR request for Emma Johnson · ask $290')
    ).toBeInTheDocument()
    expect(posts()[0]![0]).toBe('/api/financial-aid/requests/2027/additions')
    await waitFor(() => expect(formsReads()).toBeGreaterThan(before))
    // Kept in view (design rule 22): still drawn, now "added", and not counted.
    await waitFor(() =>
      expect(within(rowOf('Emma Johnson')).getByText('added')).toBeInTheDocument()
    )
    expect(rowOf('Emma Johnson')).toHaveAttribute('data-kept', 'true')
    expect(screen.getByText('4 rows · 4 families')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Needs a look 4' })).toBeInTheDocument()
  })

  it('marks a rule-made request reviewed, and keeps the row in view', async () => {
    renderAt()
    await screen.findByText('Ava Chen-Okafor')
    forms = formsRead(
      ROWS_2027.map((r) =>
        r.key === AVA.key
          ? {
              ...r,
              needs_look: false,
              became: (r.became ?? []).map((b) =>
                b.origin === 'registration_ask'
                  ? { ...b, reviewed: true, reviewed_by: 'Pat Garcia' }
                  : b
              ),
            }
          : r
      )
    )
    await userEvent.click(
      within(rowOf('Ava Chen-Okafor')).getByRole('button', { name: 'Mark Reviewed' })
    )
    await waitFor(() =>
      expect(posts()[0]![0]).toBe(
        '/api/financial-aid/requests/2027/additions/addava00000001/review'
      )
    )
    expect(
      await screen.findByText(
        "✓ Marked reviewed: Ava Chen-Okafor's request from a registration ask"
      )
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(within(rowOf('Ava Chen-Okafor')).getByText('reg. ask')).toBeInTheDocument()
    )
    expect(rowOf('Ava Chen-Okafor')).toHaveAttribute('data-kept', 'true')
  })

  it('says so when Needs a look is empty, and keeps the toolbar', async () => {
    forms = formsRead(ROWS_2027.map((r) => ({ ...r, needs_look: false })))
    renderAt()
    expect(await screen.findByText(/Nothing needs a look\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All forms 8' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download CSV/ })).toBeInTheDocument()
  })

  it('bounds a long list in a scroll box (a real season)', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      intakeRow({
        key: `${String(1000200 + i)}:${String(1000300 + i)}`,
        household_cm_id: 1000200 + i,
        person_cm_id: 1000300 + i,
        camper_name: `Camper ${String(i)} Garcia`,
        enrolled_session_cm_ids: [S1],
        needs_look: true,
      })
    )
    forms = formsRead([...ROWS_2027, ...many])
    renderAt()
    await screen.findByText('Camper 0 Garcia')
    expect(screen.getByRole('table').parentElement).toHaveClass('max-h-[420px]')
  })

  it('links the outside grants that wait for a camper to Money › To place, and drops the line at zero', async () => {
    const view = renderAt()
    await screen.findByText('Emma Johnson')
    expect(screen.getByText(/2 outside grants wait for a camper/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Money › To place' })).toHaveAttribute(
      'href',
      '/aid/money/to-place?year=2027'
    )
    view.unmount()
    forms = { ...formsRead(), grants_waiting_for_camper: 0 }
    renderAt()
    await screen.findByText('Emma Johnson')
    expect(screen.queryByText(/outside grants? waits? for a camper/)).toBeNull()
  })

  it('draws the four notes, and marks Form asked, Became and CampMinder aid with theirs', async () => {
    renderAt()
    await screen.findByText(/what needs staff\./)
    const header = screen.getByRole('columnheader', { name: /Became/ })
    expect(header.querySelector('sup')).toHaveTextContent('2')
  })

  it('finds a camper not listed and adds a request for them; one with no household cannot be added', async () => {
    unlisted = {
      year: 2027,
      sessions: SESSIONS,
      rows: [
        intakeRow({
          key: '1000003:1000032',
          household_cm_id: 1000003,
          household_label: 'Wei & Lin Chen',
          person_cm_id: 1000032,
          camper_name: 'Sofia Chen',
          enrolled_session_cm_ids: [S1],
          why_not: 'enrolled_no_request',
          gap_sessions: [{ session_cm_id: S1, program_key: 'summer', campminder_amount: null }],
          can_add: true,
        }),
        intakeRow({
          key: '0:1000071',
          household_cm_id: 0,
          household_label: '',
          person_cm_id: 1000071,
          camper_name: 'Jonah Sam',
          enrolled_session_cm_ids: [S1],
          why_not: 'no_household',
          can_add: false,
        }),
      ],
    }
    renderAt()
    await screen.findByText('Emma Johnson')
    await userEvent.click(screen.getByRole('button', { name: 'Find a Camper Not Listed…' }))
    const panel = screen.getByTestId('find-unlisted')
    await userEvent.type(within(panel).getByRole('searchbox', { name: "A camper's name" }), 'Chen')
    await within(panel).findByText('Sofia Chen')
    expect(within(panel).getByText('fix the household in CampMinder first')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Add a Request…' }))
    expect(within(panel).getByText('Add a Request · Sofia Chen')).toBeInTheDocument()
    await userEvent.type(within(panel).getByLabelText('Ask'), '1500')
    await userEvent.type(within(panel).getByLabelText('Reason'), 'On no form; family called')
    await userEvent.click(within(panel).getByRole('button', { name: 'Add Request' }))
    expect(
      await screen.findByText('✓ Added a S1 request for Sofia Chen · ask $1,500')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('find-unlisted')).toBeNull()
  })
})
