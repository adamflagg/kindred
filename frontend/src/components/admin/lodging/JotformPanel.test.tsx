/**
 * The Jotform tab (kindred#2759): one card per active-season adult weekend,
 * the field mapping, Save & pull (kindred#2828), and the unmatched queue with
 * its labelled suggestions, duplicates and staff links. The hooks are mocked;
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

describe('JotformPanel — queue', () => {
  it("says once that matching hasn't run for a weekend with no name mapped", () => {
    const data = queue.data as { unmatched: unknown[]; unmapped?: unknown[] }
    data.unmatched = []
    data.unmapped = [{ session_cm_id: 1000002, session_name: "Women's Weekend" }]
    const { unmount } = renderPanel()
    expect(
      screen.getByText(
        "Matching hasn't run for Women's Weekend: first and last name aren't mapped yet."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Every submission is matched to a guest.')).not.toBeInTheDocument()
    unmount()
    renderPanel('?session=1000003')
    expect(screen.queryByText(/Matching hasn't run/)).not.toBeInTheDocument()
  })

  it('links a suggestion, links by hand, and ignores', () => {
    renderPanel()
    const item = screen.getByTestId('jotform-unmatched-6600000000000000002')
    expect(within(item).getByText('Did you mean Emma Johnson?')).toBeInTheDocument()
    fireEvent.click(within(item).getByRole('button', { name: 'Link to Emma Johnson' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'link',
      submissionId: '6600000000000000002',
      personCmId: 1000005,
    })

    fireEvent.change(within(item).getByRole('combobox', { name: 'Guest for Emma Ohnson' }), {
      target: { value: '1000006' },
    })
    fireEvent.click(within(item).getByRole('button', { name: 'Link chosen guest' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'link',
      submissionId: '6600000000000000002',
      personCmId: 1000006,
    })

    fireEvent.click(within(item).getByRole('button', { name: 'Ignore' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'ignore',
      submissionId: '6600000000000000002',
    })
  })

  it('offers no Link for a suggestion that points at another submission, not a guest', () => {
    // A "likely duplicate" can name another UNMATCHED submission: there is no
    // person to link to, so the label shows and no Link button does.
    const data = queue.data as { unmatched: Array<{ suggestions: unknown[] }> }
    data.unmatched[0]!.suggestions = [
      {
        kind: 'likely_duplicate',
        label: 'Likely the same person as Emma Ohnsen’s submission',
        person_cm_id: 0,
        other_submission_id: '6600000000000000009',
      },
    ]
    renderPanel()
    const item = screen.getByTestId('jotform-unmatched-6600000000000000002')
    expect(
      within(item).getByText('Likely the same person as Emma Ohnsen’s submission')
    ).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /^Link to/ })).not.toBeInTheDocument()
  })

  it('unlinks a staff link and shows duplicates with their filings', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Liam Riley' }))
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'unlink',
      submissionId: '6600000000000000003',
    })
    const group = screen.getByTestId('jotform-duplicate-1000004')
    expect(group).toHaveTextContent('Olivia Chen')
    expect(group).toHaveTextContent('Emma Johnson, Riley Sam')
    expect(group).toHaveTextContent('Aug 3')
  })

  it('labels an ignored row Restore, which un-ignores it, and keeps Unlink for staff links', () => {
    // Un-ignoring is the same endpoint as unlinking, but "Unlink" on a row
    // that was never linked to anyone misdescribes what the button does.
    const data = queue.data as { resolved: Array<Record<string, unknown>> }
    data.resolved.push({
      submission_id: '6600000000000000004',
      session_cm_id: 1000002,
      submitted_name: 'Riley Sam',
      submitted_at: '2026-09-02 09:00:00',
      match_status: 'ignored',
      person_cm_id: 0,
    })
    renderPanel()
    expect(screen.queryByRole('button', { name: 'Unlink Riley Sam' })).not.toBeInTheDocument()
    const restore = screen.getByRole('button', { name: 'Restore Riley Sam' })
    expect(restore).toHaveTextContent('Restore')
    fireEvent.click(restore)
    expect(act.mutate).toHaveBeenLastCalledWith({
      kind: 'unlink',
      submissionId: '6600000000000000004',
    })
    expect(screen.getByRole('button', { name: 'Unlink Liam Riley' })).toHaveTextContent('Unlink')
  })

  it('offers no Link for a suggested person who is not an enrolled guest of the weekend', () => {
    // A likely duplicate can point at another filing whose person has since
    // left the weekend; the server refuses that link, so no button is drawn.
    const data = queue.data as { unmatched: Array<{ suggestions: unknown[] }> }
    data.unmatched[0]!.suggestions = [
      {
        kind: 'likely_duplicate',
        label: 'Likely a duplicate of Olivia Chen’s submission',
        person_cm_id: 1000009,
        guest_name: 'Olivia Chen',
        other_submission_id: '6600000000000000010',
      },
    ]
    renderPanel()
    const item = screen.getByTestId('jotform-unmatched-6600000000000000002')
    expect(
      within(item).getByText('Likely a duplicate of Olivia Chen’s submission')
    ).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /^Link to/ })).not.toBeInTheDocument()
  })

  it('says (no request) for a filing that left the bunking request empty', () => {
    const data = queue.data as {
      duplicates: Array<{ submissions: Array<{ bunking_request?: string }> }>
    }
    data.duplicates[0]!.submissions[0]!.bunking_request = ''
    renderPanel()
    expect(screen.getByTestId('jotform-duplicate-1000004')).toHaveTextContent('Aug 3: (no request)')
  })

  it("shows a guest who filed twice for each weekend once on each weekend's tab", () => {
    // A person can be enrolled in two adult weekends; the API returns one
    // group per (person, weekend).
    const data = queue.data as { duplicates: Array<Record<string, unknown>> }
    const first = data.duplicates[0]!
    data.duplicates.push({
      ...first,
      session_cm_id: 1000003,
      change_kind: 'identical',
      submissions: [
        {
          submission_id: '66c',
          session_cm_id: 1000003,
          submitted_name: 'Olivia Chen',
          submitted_at: '2026-09-05 09:00:00',
          match_status: 'auto',
          bunking_request: 'Samuel Johnson',
        },
      ],
    })
    const { unmount } = renderPanel()
    expect(screen.getAllByTestId('jotform-duplicate-1000004')).toHaveLength(1)
    expect(screen.getByTestId('jotform-duplicate-1000004')).not.toHaveTextContent('Samuel Johnson')
    unmount()
    renderPanel('?session=1000003')
    expect(screen.getAllByTestId('jotform-duplicate-1000004')).toHaveLength(1)
    expect(screen.getByTestId('jotform-duplicate-1000004')).toHaveTextContent('Samuel Johnson')
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

  it("filters the queue, duplicates and staff links to the tab's weekend", () => {
    const data = queue.data as {
      unmatched: Array<Record<string, unknown>>
      resolved: Array<Record<string, unknown>>
      duplicates: Array<Record<string, unknown>>
    }
    data.unmatched.push({
      submission_id: '6600000000000000020',
      session_cm_id: 1000003,
      session_name: "Men's Weekend",
      submitted_name: 'Samuel Jonson',
      submitted_at: '2026-09-10 09:00:00',
      match_status: 'unmatched',
      suggestions: [],
    })
    data.resolved.push({
      submission_id: '6600000000000000021',
      session_cm_id: 1000003,
      submitted_name: 'Liam Garsia',
      submitted_at: '2026-09-11 09:00:00',
      match_status: 'ignored',
      person_cm_id: 0,
    })
    data.duplicates.push({
      person_cm_id: 1000008,
      guest_name: 'Riley Sam',
      session_cm_id: 1000003,
      change_kind: 'identical',
      submissions: [],
    })

    const { unmount } = renderPanel()
    expect(screen.getByTestId('jotform-unmatched-6600000000000000002')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-unmatched-6600000000000000020')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlink Liam Riley' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore Liam Garsia' })).not.toBeInTheDocument()
    expect(screen.getByTestId('jotform-duplicate-1000004')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-duplicate-1000008')).not.toBeInTheDocument()
    expect(screen.getByText('Needs a guest (1)')).toBeInTheDocument()
    unmount()

    renderPanel('?session=1000003')
    expect(screen.getByTestId('jotform-unmatched-6600000000000000020')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-unmatched-6600000000000000002')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore Liam Garsia' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlink Liam Riley' })).not.toBeInTheDocument()
    expect(screen.getByTestId('jotform-duplicate-1000008')).toBeInTheDocument()
    expect(screen.queryByTestId('jotform-duplicate-1000004')).not.toBeInTheDocument()
  })

  it('says beside the pull button that it pulls every enabled weekend', () => {
    renderPanel()
    expect(
      within(screen.getByTestId('jotform-form-1000002')).getByText(/pulls every enabled weekend/i)
    ).toBeInTheDocument()
  })
})
