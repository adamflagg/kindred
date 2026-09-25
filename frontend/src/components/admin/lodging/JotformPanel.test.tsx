/**
 * The Jotform tab (kindred#2759): one card per active-season adult weekend,
 * the field mapping and Save & pull (kindred#2828). The unmatched queue moved
 * to each adult weekend's Requests tab (ruling 2026-09-25): its cases are in
 * `JotformQueue.test.tsx`, and this tab only links there. The hooks are mocked;
 * their network and invalidation contract is pinned in
 * `useJotformAdmin.test.tsx` and `useJotformPull.test.tsx`.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JotformPanel } from './JotformPanel'

/** The panel at its route, optionally with a `?session=` tab selected. */
function renderPanel(search = '') {
  return render(<JotformPanel />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[`/manage/lodging/jotform${search}`]}>{children}</MemoryRouter>
    ),
  })
}

const yearState = { currentYear: 2026 }
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({
    currentYear: yearState.currentYear,
    setCurrentYear: vi.fn(),
    isYearReady: true,
  }),
}))

const pull = { pull: vi.fn(), isPulling: false }
const save = { mutateAsync: vi.fn(), isPending: false }
const act = { mutate: vi.fn(), isPending: false }
const forms = { data: undefined as unknown, isLoading: false, error: null as Error | null }
const queue = { data: undefined as unknown, isLoading: false, error: null as Error | null }
vi.mock('../../../hooks/useJotformAdmin', () => ({
  useJotformForms: () => forms,
  useJotformQueue: () => queue,
  useSaveJotformForm: () => save,
  useJotformSubmissionAction: () => act,
  useJotformPull: () => pull,
}))

const QUESTIONS = [
  { question_id: '3', text: 'First Name', type: 'control_textbox' },
  { question_id: '4', text: 'Last Name', type: 'control_textbox' },
  {
    question_id: '21',
    text: 'If you have a bunking request, please list…',
    type: 'control_textarea',
  },
]

beforeEach(() => {
  yearState.currentYear = 2026
  pull.pull.mockReset()
  pull.pull.mockResolvedValue(undefined)
  save.mutateAsync.mockReset()
  save.mutateAsync.mockResolvedValue({})
  act.mutate.mockReset()
  forms.data = {
    year: 2026,
    rows: [
      {
        session_cm_id: 1000002,
        session_name: "Women's Weekend",
        form_id: '261700000000001',
        form_title: "Women's Weekend 2026",
        field_map: { first_name: '3', last_name: '4', bunking_request: '21' },
        field_map_meta: {
          first_name: { question_id: '3', text: 'First Name', source: 'carried' },
          last_name: { question_id: '4', text: 'Last Name', source: 'guessed' },
          bunking_request: {
            question_id: '21',
            text: 'Who would you like to room with?',
            source: 'staff',
            flag: 'wording_changed',
          },
          coming_with: { question_id: '', text: '', flag: 'needs_pick' },
        },
        questions: QUESTIONS,
        enabled: true,
        last_pull_status: 'ok · 3 submissions · 1 matched · 2 unmatched',
        submission_count: 3,
      },
      {
        session_cm_id: 1000003,
        session_name: "Men's Weekend",
        form_id: '',
        questions: [],
        enabled: false,
      },
    ],
  }
  queue.data = {
    year: 2026,
    unmatched: [
      {
        submission_id: '6600000000000000002',
        session_cm_id: 1000002,
        session_name: "Women's Weekend",
        submitted_name: 'Emma Ohnson',
        submitted_at: '2026-08-31 09:00:00',
        bunking_request: 'Olivia Chen',
        match_status: 'unmatched',
        suggestions: [
          {
            kind: 'did_you_mean',
            label: 'Did you mean Emma Johnson?',
            person_cm_id: 1000005,
            guest_name: 'Emma Johnson',
          },
        ],
      },
    ],
    resolved: [
      {
        submission_id: '6600000000000000003',
        session_cm_id: 1000002,
        submitted_name: 'Liam Riley',
        submitted_at: '2026-09-01 09:00:00',
        match_status: 'staff',
        person_cm_id: 1000006,
        guest_name: 'Liam Garcia',
      },
    ],
    duplicates: [
      {
        person_cm_id: 1000004,
        guest_name: 'Olivia Chen',
        session_cm_id: 1000002,
        change_kind: 'list',
        submissions: [
          {
            submission_id: '66a',
            session_cm_id: 1000002,
            submitted_name: 'Olivia Chen',
            submitted_at: '2026-08-03 09:00:00',
            match_status: 'auto',
            bunking_request: 'Emma Johnson',
          },
          {
            submission_id: '66b',
            session_cm_id: 1000002,
            submitted_name: 'Olivia Chen',
            submitted_at: '2026-08-31 09:00:00',
            match_status: 'auto',
            bunking_request: 'Emma Johnson, Riley Sam',
          },
        ],
      },
    ],
    guests: [
      {
        person_cm_id: 1000005,
        display_name: 'Emma Johnson',
        session_cm_id: 1000002,
        has_submission: false,
      },
      {
        person_cm_id: 1000006,
        display_name: 'Liam Garcia',
        session_cm_id: 1000002,
        has_submission: true,
      },
    ],
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('JotformPanel — forms', () => {
  it('draws one card per adult weekend with the resolved mapping selected', () => {
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    expect(
      within(ww).getByText('ok · 3 submissions · 1 matched · 2 unmatched', { exact: false })
    ).toBeInTheDocument()
    expect(
      within(ww).getByRole('combobox', { name: "Bunking request question for Women's Weekend" })
    ).toHaveValue('21')
  })

  it('tells a weekend with no form yet that Save & pull does the rest', () => {
    renderPanel('?session=1000003')
    const mw = screen.getByTestId('jotform-form-1000003')
    expect(within(mw).getByText(/click save & pull/i)).toBeInTheDocument()
    expect(within(mw).queryByText(/pull once to load its questions/i)).not.toBeInTheDocument()
  })

  it('enables a new form by default, so one Save & pull is the whole setup', () => {
    renderPanel('?session=1000003')
    expect(within(screen.getByTestId('jotform-form-1000003')).getByRole('checkbox')).toBeChecked()
  })

  it('reads Pull now when nothing is edited, and only pulls', async () => {
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    expect(within(ww).queryByRole('button', { name: 'Save & pull' })).not.toBeInTheDocument()
    fireEvent.click(within(ww).getByRole('button', { name: 'Pull now' }))
    await waitFor(() => expect(pull.pull).toHaveBeenCalledTimes(1))
    expect(save.mutateAsync).not.toHaveBeenCalled()
  })

  it('reads Save & pull once edited, and saves before it pulls', async () => {
    const order: string[] = []
    save.mutateAsync.mockImplementation(() => {
      order.push('save')
      return Promise.resolve({})
    })
    pull.pull.mockImplementation(() => {
      order.push('pull')
      return Promise.resolve()
    })
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    fireEvent.change(
      within(ww).getByRole('combobox', { name: "Coming with question for Women's Weekend" }),
      { target: { value: '4' } }
    )
    expect(within(ww).queryByRole('button', { name: 'Pull now' })).not.toBeInTheDocument()
    fireEvent.click(within(ww).getByRole('button', { name: 'Save & pull' }))
    await waitFor(() => expect(order).toEqual(['save', 'pull']))
    expect(save.mutateAsync).toHaveBeenCalledWith({
      sessionCmId: 1000002,
      body: {
        form_ref: '261700000000001',
        field_map: { first_name: '3', last_name: '4', bunking_request: '21', coming_with: '4' },
        enabled: true,
      },
    })
  })

  it('does not pull when the save fails', async () => {
    save.mutateAsync.mockRejectedValue(new Error('That link does not contain the form ID'))
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    fireEvent.click(within(ww).getByRole('checkbox'))
    fireEvent.click(within(ww).getByRole('button', { name: 'Save & pull' }))
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalled())
    expect(pull.pull).not.toHaveBeenCalled()
  })

  it('selects the resolved mapping when a pull first loads the questions', () => {
    // The card is already on screen when the first pull lands: the refetched
    // row gains its questions and resolved map, and the selects must follow
    // rather than keep the empty mapping the card mounted with.
    const rows = (forms.data as { rows: Array<Record<string, unknown>> }).rows
    const { rerender } = renderPanel('?session=1000003')
    rows[1] = {
      ...rows[1],
      form_id: '261700000000002',
      enabled: true,
      questions: QUESTIONS,
      field_map: { first_name: '3', bunking_request: '21' },
    }
    forms.data = { year: 2026, rows: [...rows] }
    rerender(<JotformPanel />)
    const mw = screen.getByTestId('jotform-form-1000003')
    expect(
      within(mw).getByRole('combobox', { name: "Bunking request question for Men's Weekend" })
    ).toHaveValue('21')
    expect(within(mw).getByRole('textbox', { name: "Form link for Men's Weekend" })).toHaveValue(
      '261700000000002'
    )
    expect(within(mw).getByRole('button', { name: 'Pull now' })).toBeInTheDocument()
  })

  it('badges each role with where its question came from, and flags in amber', () => {
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    expect(within(ww).getByTestId('jotform-role-first_name')).toHaveTextContent('Same as last year')
    expect(within(ww).getByTestId('jotform-role-last_name')).toHaveTextContent('Guessed')
    const reworded = within(ww).getByTestId('jotform-role-bunking_request')
    expect(within(reworded).getByText('Wording changed').className).toMatch(/amber/)
    const unpicked = within(ww).getByTestId('jotform-role-coming_with')
    expect(within(unpicked).getByText('Pick a question').className).toMatch(/amber/)
  })

  it('badges a staff role, and a removed question', () => {
    const rows = (forms.data as { rows: Array<Record<string, unknown>> }).rows
    rows[0] = {
      ...rows[0],
      field_map_meta: {
        first_name: { question_id: '3', text: 'First Name', source: 'staff' },
        cpap: { question_id: '88', text: 'CPAP?', source: 'staff', flag: 'missing' },
      },
    }
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    expect(within(ww).getByTestId('jotform-role-first_name')).toHaveTextContent('Set by staff')
    const removed = within(ww).getByTestId('jotform-role-cpap')
    expect(within(removed).getByText('Question removed').className).toMatch(/amber/)
  })

  it("drops a role's badge once staff pick a different question", () => {
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    fireEvent.change(
      within(ww).getByRole('combobox', { name: "Last name question for Women's Weekend" }),
      { target: { value: '21' } }
    )
    expect(within(ww).getByTestId('jotform-role-last_name')).not.toHaveTextContent('Guessed')
  })

  it("shows the form's Jotform title, with no warning when its year is the tab's", () => {
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    expect(within(ww).getByText("Women's Weekend 2026")).toBeInTheDocument()
    expect(within(ww).queryByText(/not 2026/)).not.toBeInTheDocument()
  })

  it("warns when the form's title names a different year", () => {
    const rows = (forms.data as { rows: Array<Record<string, unknown>> }).rows
    rows[0] = { ...rows[0], form_title: "Women's Weekend 2025" }
    renderPanel()
    const warning = within(screen.getByTestId('jotform-form-1000002')).getByText(/not 2026/)
    expect(warning).toHaveTextContent('2025')
    expect(warning.className).toMatch(/amber/)
  })

  it('gives a title with no year no warning', () => {
    const rows = (forms.data as { rows: Array<Record<string, unknown>> }).rows
    rows[0] = { ...rows[0], form_title: "Women's Weekend registration" }
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    expect(within(ww).getByText("Women's Weekend registration")).toBeInTheDocument()
    expect(within(ww).queryByText(/not 2026/)).not.toBeInTheDocument()
  })

  it("drops a card's unsaved edits when the year changes", () => {
    // CampMinder reuses a weekend's session id across years, so the card for
    // next year's Women's Weekend must not inherit this year's typed link.
    const { rerender } = renderPanel()
    const link = within(screen.getByTestId('jotform-form-1000002')).getByRole('textbox', {
      name: "Form link for Women's Weekend",
    })
    fireEvent.change(link, { target: { value: '261700000000999' } })
    yearState.currentYear = 2027
    const rows = (forms.data as { rows: Array<Record<string, unknown>> }).rows
    forms.data = { year: 2027, rows: [{ ...rows[0], form_id: '271700000000001' }] }
    rerender(<JotformPanel />)
    expect(
      within(screen.getByTestId('jotform-form-1000002')).getByRole('textbox', {
        name: "Form link for Women's Weekend",
      })
    ).toHaveValue('271700000000001')
  })

  it('clears the mapping once the form reference changes to another form', async () => {
    // Question ids belong to one form; the old form's must never be sent
    // against a different one (the server drops them too).
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    fireEvent.change(within(ww).getByRole('textbox', { name: "Form link for Women's Weekend" }), {
      target: { value: 'https://www.jotform.com/build/261700000000555' },
    })
    expect(
      within(ww).queryByRole('combobox', { name: "Bunking request question for Women's Weekend" })
    ).not.toBeInTheDocument()
    fireEvent.click(within(ww).getByRole('button', { name: 'Save & pull' }))
    await waitFor(() =>
      expect(save.mutateAsync).toHaveBeenCalledWith({
        sessionCmId: 1000002,
        body: {
          form_ref: 'https://www.jotform.com/build/261700000000555',
          field_map: {},
          enabled: true,
        },
      })
    )
  })

  it('keeps the mapping when the same form is pasted as its builder link', () => {
    renderPanel()
    const ww = screen.getByTestId('jotform-form-1000002')
    fireEvent.change(within(ww).getByRole('textbox', { name: "Form link for Women's Weekend" }), {
      target: { value: 'https://www.jotform.com/build/261700000000001' },
    })
    expect(
      within(ww).getByRole('combobox', { name: "Bunking request question for Women's Weekend" })
    ).toHaveValue('21')
    expect(within(ww).getByRole('button', { name: 'Pull now' })).toBeInTheDocument()
  })
})

describe('JotformPanel — the queue lives on the weekend (kindred#2828 ruling 2026-09-25)', () => {
  it('keeps setup only: no filings, no Needs a guest, no staff links', () => {
    renderPanel()
    expect(screen.getByTestId('jotform-form-1000002')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-unmatched-6600000000000000002')).not.toBeInTheDocument()
    expect(screen.queryByText(/Needs a guest/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('jotform-staff-links')).not.toBeInTheDocument()
    expect(screen.queryByText('Filed more than once (1)')).not.toBeInTheDocument()
    expect(act.mutate).not.toHaveBeenCalled()
  })

  it("links the weekend's Requests tab with how many filings need a guest", () => {
    renderPanel()
    const link = screen.getByRole('link', { name: /Requests tab/ })
    expect(link).toHaveAttribute('href', '/weekend/1000002/requests')
    expect(screen.getByTestId('jotform-requests-link')).toHaveTextContent('1 filing needs a guest')
  })

  it("counts only the open tab's weekend", () => {
    renderPanel('?session=1000003')
    expect(screen.getByRole('link', { name: /Requests tab/ })).toHaveAttribute(
      'href',
      '/weekend/1000003/requests'
    )
    expect(screen.getByTestId('jotform-requests-link')).toHaveTextContent('No filings need a guest')
  })
})

describe('JotformPanel — one tab per weekend', () => {
  it('draws a tab per weekend from the API and opens the first by default', () => {
    renderPanel()
    const tabs = screen.getByRole('navigation', { name: 'Adult weekends' })
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(["Women's Weekend", "Men's Weekend"])
    expect(within(tabs).getByRole('link', { name: "Women's Weekend" })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByTestId('jotform-form-1000002')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-form-1000003')).not.toBeInTheDocument()
  })

  it('takes its tabs from the API, not a fixed list', () => {
    forms.data = {
      year: 2026,
      rows: [{ session_cm_id: 1000007, session_name: 'Adult Retreat', questions: [] }],
    }
    renderPanel()
    const tabs = screen.getByRole('navigation', { name: 'Adult weekends' })
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Adult Retreat'])
  })

  it('selects the tab named by ?session= and links each tab to its own', () => {
    renderPanel('?session=1000003')
    const tabs = screen.getByRole('navigation', { name: 'Adult weekends' })
    expect(within(tabs).getByRole('link', { name: "Men's Weekend" })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(within(tabs).getByRole('link', { name: "Women's Weekend" })).toHaveAttribute(
      'href',
      '/manage/lodging/jotform?session=1000002'
    )
    expect(screen.getByTestId('jotform-form-1000003')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-form-1000002')).not.toBeInTheDocument()
  })

  it('switches weekends when a tab is clicked', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('link', { name: "Men's Weekend" }))
    expect(screen.getByTestId('jotform-form-1000003')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-form-1000002')).not.toBeInTheDocument()
  })

  it('falls back to the first weekend for an unknown ?session=', () => {
    renderPanel('?session=999')
    expect(screen.getByTestId('jotform-form-1000002')).toBeInTheDocument()
  })

  it('says beside the pull button that it pulls every enabled weekend', () => {
    renderPanel()
    expect(
      within(screen.getByTestId('jotform-form-1000002')).getByText(/pulls every enabled weekend/i)
    ).toBeInTheDocument()
  })
})
