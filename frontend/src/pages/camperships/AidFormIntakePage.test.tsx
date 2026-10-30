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
import {
  ADULT_SESSIONS,
  CASEY,
  DANA,
  DANA_LINK,
  FC4,
  FC4A,
  JORDAN,
  LAST_READ,
  LIN,
  REFUSED,
} from '../../components/camperships/intake/adultFormFixtures'
import type { BecameOut, FormAnswerOut } from '../../components/camperships/intake/intakeTypes'
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
    if (init?.method === 'POST' && path.endsWith('/form-responses/pull'))
      return Promise.resolve(json({ status: 'started' }, 202))
    if (init?.method === 'POST' && path.includes('/form-responses/'))
      return Promise.resolve(json({ id: 'x', response_id: 'x', match_status: 'staff' }))
    if (init?.method === 'POST' && path.includes('/form-changes/'))
      return Promise.resolve(json({ request_id: 'x', reviewed_by: 'me', reviewed_at: '' }))
    if (init?.method === 'POST') return Promise.resolve(json({ addition: {}, request: {} }, 201))
    if (path.includes('/candidates')) return Promise.resolve(json(DANA_LINK))
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

  describe('the visual audit (2026-10-15)', () => {
    it("finds a camper by their own name, not only by their household's", async () => {
      renderAt('/aid/requests/intake?year=2027&show=all')
      await screen.findByText('Emma Johnson')
      await userEvent.type(screen.getByPlaceholderText('Find a camper…'), 'Olivia')
      await waitFor(() => expect(names()).toEqual([ROWS_2027[1]!.key]))
    })

    it('names the session Add a Request… adds in its title', async () => {
      renderAt()
      await screen.findByText('Emma Johnson')
      expect(
        within(rowOf('Emma Johnson')).getByRole('button', { name: 'Add a Request…' })
      ).toHaveAttribute('title', 'Add a request for Emma Johnson: Teen Winter Retreat')
    })

    it('says who added a request by name and on the day at camp, never an email or a UTC day', async () => {
      const added = intakeRow({
        key: '1000009:1000091',
        household_cm_id: 1000009,
        household_label: 'Pat & Sam Rivera',
        person_cm_id: 1000091,
        camper_name: 'Noah Rivera',
        enrolled_session_cm_ids: [S1],
        became: [
          became({
            request_id: 'reqnoahriv00001',
            origin: 'added',
            addition_id: 'addnoahriv00001',
            added_by: 'pat.garcia@example.com',
            // 02:00 UTC on Mar 4 is the evening of Mar 3 at camp.
            added_at: '2027-03-04 02:00:00.000Z',
            added_reason: 'Assessed by phone',
          }),
        ],
      })
      forms = formsRead([...ROWS_2027, added])
      renderAt('/aid/requests/intake?year=2027&show=all')
      await screen.findByText('Noah Rivera')
      // Open the row from a plain cell (the name is a link to the household).
      await userEvent.click(within(rowOf('Noah Rivera')).getAllByRole('cell')[2]!)
      expect(within(rowOf('Noah Rivera')).getByText('added')).toHaveAttribute(
        'title',
        'Added by Pat, Mar 3: “Assessed by phone”'
      )
      expect(await screen.findByText(/S1 \(added by Pat, Mar 3\)/)).toBeInTheDocument()
    })
  })
})

// CLOSED-SEASONS-DONE (owner ruling NG-01): a closed season's Form intake is history. The server sends no look
// reason, no Add a Request… and a waiting request as Closed (close_intake_row), and says `season_done`.
describe('a closed season (CLOSED-SEASONS-DONE)', () => {
  const closedForms = () => {
    const rows = ROWS_2027.map((r): FormIntakeRowOut => ({
      ...r,
      needs_look: false,
      look_reasons: [],
      can_add: false,
      became: (r.became ?? []).map((b) =>
        b.status === 'session_unclear' || b.status === 'duplicate_pending'
          ? { ...b, status: 'closed' as const }
          : b
      ),
    }))
    return { ...formsRead(rows), grants_waiting_for_camper: 0, season_done: true }
  }
  beforeEach(() => {
    forms = closedForms()
  })

  it('opens on All forms, Needs a look reading 0 (CSD-6)', async () => {
    renderAt()
    await screen.findByText('Emma Johnson')
    const filters = screen.getByRole('group', { name: 'Show' })
    expect(within(filters).getByRole('button', { name: 'All forms 8' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(filters).getByRole('button', { name: 'Needs a look 0' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(names()).toHaveLength(8)
  })

  it('still opens Needs a look when a link asks for it, and says why it is empty', async () => {
    renderAt('/aid/requests/intake?year=2027&show=look')
    expect(await screen.findByText(/Nothing needs a look\. 2027 is closed/)).toBeInTheDocument()
  })

  it('says so in the band, in place of "(live)" (CSD-2)', async () => {
    renderAt()
    await screen.findByText('Emma Johnson')
    expect(
      screen.getByText('Requests · Season 2027 · closed, shown as history')
    ).toBeInTheDocument()
  })

  it('offers no action column and no Find a Camper Not Listed…, even to casework', async () => {
    renderAt()
    await screen.findByText('Emma Johnson')
    expect(screen.queryByRole('button', { name: 'Add a Request…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark Reviewed' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Find a Camper Not Listed…' })).toBeNull()
  })

  it("keeps CampMinder's aid at its amounts in plain ink, with no amber footer sum", async () => {
    renderAt()
    await screen.findByText('Riley Sam')
    const aid = within(rowOf('Riley Sam')).getByText('$2,258')
    expect(aid.className).not.toMatch(/amber/)
    expect(document.querySelector('tfoot [class*="amber"]')?.outerHTML).toBeUndefined()
  })

  it('reads a request still waiting at close as Closed (CSD-1)', async () => {
    renderAt()
    await screen.findByText('Olivia Chen')
    expect(within(rowOf('Olivia Chen')).getByText('Closed')).toBeInTheDocument()
    expect(within(rowOf('Olivia Chen')).queryByText('Session unclear')).toBeNull()
  })
})

describe('an adult aid form row (adult aid form mock v2: K1 a, callouts 1–3)', () => {
  const grace = intakeRow({
    key: '1000016:1000161',
    household_cm_id: 1000016,
    household_label: 'Grace & Tom Chen-Whitfield',
    person_cm_id: 1000161,
    camper_name: 'Grace Chen-Whitfield',
    filed: true,
    registration_only: false,
    answers: [
      {
        program_key: 'family_camp',
        option_text: 'Family Camp 4: Labor Day (Sep 3-6)',
        ask: 700,
        named_session_cm_id: FC4,
        form_source: 'google_form',
      } as FormAnswerOut,
    ],
    enrolled_session_cm_ids: [FC4A],
    became: [
      {
        ...became({ program_key: 'family_camp', session_cm_id: FC4A, ask: 700 }),
        form_source: 'google_form',
        price_missing: true,
      } as BecameOut,
    ],
  })
  beforeEach(() => {
    forms = { ...formsRead([...ROWS_2027, grace]), sessions: [...SESSIONS, ...ADULT_SESSIONS] }
  })

  it('callout 1: Form asked widens 262 → 280px, taken from Camper (300 → 282)', async () => {
    renderAt('/aid/requests/intake?year=2027&show=all')
    await screen.findByText('Grace Chen-Whitfield')
    const widths = [...document.querySelectorAll('colgroup col')].map(
      (c) => (c as HTMLElement).style.width
    )
    expect(widths.slice(0, 2)).toEqual(['282px', '280px'])
  })

  it('K1 a and callout 2: the outlined adult aid form chip, then the weekend and ask with no program prefix', async () => {
    renderAt('/aid/requests/intake?year=2027&show=all')
    await screen.findByText('Grace Chen-Whitfield')
    const row = rowOf('Grace Chen-Whitfield')
    const chip = within(row).getByText('adult aid form')
    expect(chip.className).toContain('border')
    expect(within(row).getByText('Family Camp 4 · $700')).toBeInTheDocument()
    expect(within(row).queryByText(/Family Camp: Family Camp 4/)).toBeNull()
    // CampMinder rows stay unmarked.
    expect(within(rowOf('Emma Johnson')).queryByText('adult aid form')).toBeNull()
  })

  it('callout 3: a request with no price yet says so, in amber, after its session', async () => {
    renderAt('/aid/requests/intake?year=2027&show=all')
    await screen.findByText('Grace Chen-Whitfield')
    const row = rowOf('Grace Chen-Whitfield')
    const flag = within(row).getByText('no price yet')
    expect(flag.className).toMatch(/amber/)
    expect(flag).toHaveAttribute('title', expect.stringContaining('No price yet'))
  })

  it("the opened row names the request's form", async () => {
    renderAt('/aid/requests/intake?year=2027&show=all')
    await userEvent.click(await screen.findByText('Family Camp 4 · $700'))
    expect(
      await screen.findByText(/Requests: FC4 Adults \(from the adult aid form\)/)
    ).toBeInTheDocument()
  })
})

describe("the adult aid form's responses (adult aid form mock v2, steps 4–20)", () => {
  const jordan = intakeRow({
    key: '1000018:1000181',
    household_cm_id: 1000018,
    household_label: 'Jordan & Casey Sam',
    person_cm_id: 1000181,
    camper_name: 'Jordan Sam',
    filed: true,
    registration_only: false,
    needs_look: true,
    look_reasons: ['form_changed_after_decision'],
    answers: [
      {
        program_key: 'family_camp',
        option_text: 'Family Camp 4: Labor Day (Sep 3-6)',
        ask: 600,
        named_session_cm_id: FC4,
        form_source: 'google_form',
      },
    ],
    enrolled_session_cm_ids: [FC4A],
    became: [
      {
        ...became({ program_key: 'family_camp', session_cm_id: FC4A, ask: 600 }),
        request_id: 'reqjordan000001',
        form_source: 'google_form',
        form_change: {
          kind: 'changed_after_decision',
          at: '2026-11-10T18:00:00Z',
          reviewed: false,
        },
      },
    ],
  })
  beforeEach(() => {
    forms = {
      ...formsRead([...ROWS_2027, jordan]),
      sessions: [...SESSIONS, ...ADULT_SESSIONS],
      form_responses: [DANA, CASEY, LIN, JORDAN],
      google_form: LAST_READ,
    }
  })

  it('Responses to link: a segment of its own, second, each response with Link… and Ignore…', async () => {
    renderAt('/aid/requests/intake?year=2027&show=link')
    const dana = (await screen.findByText('“Dana Okafor”')).closest('tr') as HTMLElement
    expect(screen.getByRole('button', { name: /Responses to link/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(dana).getByText('not linked')).toBeInTheDocument()
    expect(within(dana).getByText('Suggested')).toBeInTheDocument()
    expect(
      within(dana).getByText('Dana Okafor or Dana Okafor-Reyes · name only')
    ).toBeInTheDocument()
    expect(within(dana).getByRole('button', { name: 'Link…' })).toBeInTheDocument()
    expect(within(dana).getByRole('button', { name: 'Ignore…' })).toBeInTheDocument()
    expect(screen.getByText('“Casey Sam”')).toBeInTheDocument()
    expect(screen.queryByText('“Lin Chen”')).toBeNull()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
  })

  it('an ignored response shows under All forms, offering only Link…', async () => {
    renderAt('/aid/requests/intake?year=2027&show=all')
    const lin = (await screen.findByText('“Lin Chen”')).closest('tr') as HTMLElement
    expect(within(lin).getByText('Ignored')).toBeInTheDocument()
    expect(within(lin).getByRole('button', { name: 'Link…' })).toBeInTheDocument()
    expect(within(lin).queryByRole('button', { name: 'Ignore…' })).toBeNull()
  })

  it('a response opened: what it asked, that no request is made yet, and its three panels', async () => {
    renderAt('/aid/requests/intake?year=2027&show=link')
    await userEvent.click(await screen.findByText('“Dana Okafor”'))
    expect(
      await screen.findByText('No request until the response is linked · typed “Dana Okafor”')
    ).toBeInTheDocument()
    expect(document.querySelector('[data-adult-form-panels]')).not.toBeNull()
  })

  it('Link…: candidates first with the respondent email, and Link Response posts the person', async () => {
    renderAt('/aid/requests/intake?year=2027&show=link')
    const dana = (await screen.findByText('“Dana Okafor”')).closest('tr') as HTMLElement
    expect(screen.queryByText('sam.lee@example.com')).toBeNull()
    await userEvent.click(within(dana).getByRole('button', { name: 'Link…' }))
    expect(await screen.findByText('sam.lee@example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Link Response' }))
    await waitFor(() =>
      expect(
        posts().some(([url]) => String(url).endsWith(`/intake/2027/form-responses/${DANA.id}/link`))
      ).toBe(true)
    )
    const [, init] = posts().find(([url]) => String(url).endsWith('/link'))!
    expect(JSON.parse(init?.body as string)).toEqual({ person_cm_id: 1000121 })
    expect(await screen.findByText(/✓ Linked/)).toBeInTheDocument()
  })

  it('Ignore…: Ignore Response stays off until a reason is picked, then posts it', async () => {
    renderAt('/aid/requests/intake?year=2027&show=link')
    const casey = (await screen.findByText('“Casey Sam”')).closest('tr') as HTMLElement
    await userEvent.click(within(casey).getByRole('button', { name: 'Ignore…' }))
    const save = await screen.findByRole('button', { name: 'Ignore Response' })
    expect(save).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /Why/ }))
    await userEvent.click(screen.getByRole('option', { name: 'A test or junk response' }))
    await userEvent.click(save)
    await waitFor(() =>
      expect(
        posts().some(([url]) =>
          String(url).endsWith(`/intake/2027/form-responses/${CASEY.id}/ignore`)
        )
      ).toBe(true)
    )
  })

  it('K4: the last read sits beside Pull Now, and Pull Now starts a read', async () => {
    renderAt()
    expect(await screen.findByText('Last read from Google: 14:20')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pull Now' }))
    expect(
      await screen.findByText(
        '✓ Reading the adult aid form from Google: the list refreshes when it lands'
      )
    ).toBeInTheDocument()
    expect(posts().some(([url]) => String(url).endsWith('/intake/2027/form-responses/pull'))).toBe(
      true
    )
  })

  it('callout 4: a refused read is a warn row in every segment, and the last read turns amber', async () => {
    forms = { ...forms, google_form: REFUSED }
    renderAt()
    const lead =
      '⚠ The 14:20 read was refused: Google returned 0 of 12 responses, so nothing was removed.'
    expect(await screen.findByText(lead)).toBeInTheDocument()
    expect(screen.getByText('⚠ Read refused 14:20')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /All forms/ }))
    expect(await screen.findByText(lead)).toBeInTheDocument()
  })

  it('Mark Reviewed on a request whose form changed after a decision', async () => {
    renderAt()
    await screen.findByText('Jordan Sam')
    const row = rowOf('Jordan Sam')
    expect(within(row).getByText('flagged, not applied')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Mark Reviewed' }))
    await waitFor(() =>
      expect(
        posts().some(([url]) =>
          String(url).endsWith('/requests/2027/form-changes/reqjordan000001/review')
        )
      ).toBe(true)
    )
  })

  it("an opened linked row shows its response's panels, the flagged second response among them", async () => {
    renderAt()
    await screen.findByText('Jordan Sam')
    await userEvent.click(within(rowOf('Jordan Sam')).getByText('flagged, not applied'))
    expect(
      await screen.findByText('Second response, Nov 10, after a decision: flagged, not applied')
    ).toBeInTheDocument()
  })
})
