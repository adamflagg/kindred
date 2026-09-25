/**
 * The Jotform tab (kindred#2759): one card per active-season adult weekend,
 * the field mapping, Pull now, and the unmatched queue with its labelled
 * suggestions, duplicates and staff links. The hooks are mocked; their
 * network and invalidation contract is pinned in `useJotformAdmin.test.tsx`.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JotformPanel } from './JotformPanel'

const yearState = { currentYear: 2026 }
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({
    currentYear: yearState.currentYear,
    setCurrentYear: vi.fn(),
    isYearReady: true,
  }),
}))

const runSync = { mutate: vi.fn(), isPending: false }
vi.mock('../../../hooks/useRunIndividualSync', () => ({ useRunIndividualSync: () => runSync }))

const save = { mutate: vi.fn(), isPending: false }
const act = { mutate: vi.fn(), isPending: false }
const forms = { data: undefined as unknown, isLoading: false, error: null as Error | null }
const queue = { data: undefined as unknown, isLoading: false, error: null as Error | null }
vi.mock('../../../hooks/useJotformAdmin', () => ({
  useJotformForms: () => forms,
  useJotformQueue: () => queue,
  useSaveJotformForm: () => save,
  useJotformSubmissionAction: () => act,
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
  runSync.mutate.mockReset()
  save.mutate.mockReset()
  act.mutate.mockReset()
  forms.data = {
    year: 2026,
    rows: [
      {
        session_cm_id: 1000002,
        session_name: "Women's Weekend",
        form_id: '261700000000001',
        field_map: {},
        suggested_field_map: { first_name: '3', last_name: '4', bunking_request: '21' },
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
  it('draws one card per adult weekend with the suggested mapping preselected', () => {
    render(<JotformPanel />)
    const ww = screen.getByTestId('jotform-form-1000002')
    expect(
      within(ww).getByText('ok · 3 submissions · 1 matched · 2 unmatched', { exact: false })
    ).toBeInTheDocument()
    expect(
      within(ww).getByRole('combobox', { name: "Bunking request question for Women's Weekend" })
    ).toHaveValue('21')
    expect(
      within(screen.getByTestId('jotform-form-1000003')).getByText(
        /pull once to load its questions/i
      )
    ).toBeInTheDocument()
  })

  it('saves the link, the confirmed mapping and the enabled flag', () => {
    render(<JotformPanel />)
    const ww = screen.getByTestId('jotform-form-1000002')
    fireEvent.change(
      within(ww).getByRole('combobox', { name: "Coming with question for Women's Weekend" }),
      { target: { value: '4' } }
    )
    fireEvent.click(within(ww).getByRole('button', { name: "Save Women's Weekend" }))
    expect(save.mutate).toHaveBeenCalledWith({
      sessionCmId: 1000002,
      body: {
        form_ref: '261700000000001',
        field_map: { first_name: '3', last_name: '4', bunking_request: '21', coming_with: '4' },
        enabled: true,
      },
    })
  })

  it('preselects the suggested mapping when a pull first loads the questions', () => {
    // The card is already on screen when the first pull lands: the refetched
    // row gains its questions and suggestions, and the selects must follow
    // rather than keep the empty mapping the card mounted with.
    const rows = (forms.data as { rows: Array<Record<string, unknown>> }).rows
    const { rerender } = render(<JotformPanel />)
    rows[1] = {
      ...rows[1],
      form_id: '261700000000002',
      enabled: true,
      questions: QUESTIONS,
      suggested_field_map: { first_name: '3', bunking_request: '21' },
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
  })

  it("drops a card's unsaved edits when the year changes", () => {
    // CampMinder reuses a weekend's session id across years, so the card for
    // next year's Women's Weekend must not inherit this year's typed link.
    const { rerender } = render(<JotformPanel />)
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

  it('clears the mapping once the form reference changes to another form', () => {
    // Question ids belong to one form; the old form's must never be sent
    // against a different one (the server drops them too).
    render(<JotformPanel />)
    const ww = screen.getByTestId('jotform-form-1000002')
    fireEvent.change(within(ww).getByRole('textbox', { name: "Form link for Women's Weekend" }), {
      target: { value: 'https://www.jotform.com/build/261700000000555' },
    })
    expect(
      within(ww).queryByRole('combobox', { name: "Bunking request question for Women's Weekend" })
    ).not.toBeInTheDocument()
    fireEvent.click(within(ww).getByRole('button', { name: "Save Women's Weekend" }))
    expect(save.mutate).toHaveBeenCalledWith({
      sessionCmId: 1000002,
      body: {
        form_ref: 'https://www.jotform.com/build/261700000000555',
        field_map: {},
        enabled: true,
      },
    })
  })

  it('keeps the mapping when the same form is pasted as its builder link', () => {
    render(<JotformPanel />)
    const ww = screen.getByTestId('jotform-form-1000002')
    fireEvent.change(within(ww).getByRole('textbox', { name: "Form link for Women's Weekend" }), {
      target: { value: 'https://www.jotform.com/build/261700000000001' },
    })
    expect(
      within(ww).getByRole('combobox', { name: "Bunking request question for Women's Weekend" })
    ).toHaveValue('21')
  })

  it('Pull now runs the Jotform sync job', () => {
    render(<JotformPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Pull now' }))
    expect(runSync.mutate).toHaveBeenCalledWith('jotform_submissions')
  })
})

describe('JotformPanel — queue', () => {
  it('links a suggestion, links by hand, and ignores', () => {
    render(<JotformPanel />)
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
    render(<JotformPanel />)
    const item = screen.getByTestId('jotform-unmatched-6600000000000000002')
    expect(
      within(item).getByText('Likely the same person as Emma Ohnsen’s submission')
    ).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /^Link to/ })).not.toBeInTheDocument()
  })

  it('unlinks a staff link and shows duplicates with their filings', () => {
    render(<JotformPanel />)
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
    render(<JotformPanel />)
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

  it("names a duplicate group's weekend from the forms list", () => {
    // The API sends duplicate filings without a session_name; the weekend
    // comes from the group's session_cm_id.
    render(<JotformPanel />)
    expect(screen.getByTestId('jotform-duplicate-1000004')).toHaveTextContent("Women's Weekend")
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
    render(<JotformPanel />)
    const item = screen.getByTestId('jotform-unmatched-6600000000000000002')
    expect(
      within(item).getByText('Likely a duplicate of Olivia Chen’s submission')
    ).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /^Link to/ })).not.toBeInTheDocument()
  })

  it('says (no request) for a filing that left the bunking request empty', () => {
    const data = queue.data as {
      duplicates: Array<{ submissions: Array<Record<string, unknown>> }>
    }
    data.duplicates[0]!.submissions[0]!.bunking_request = ''
    render(<JotformPanel />)
    expect(screen.getByTestId('jotform-duplicate-1000004')).toHaveTextContent('Aug 3: (no request)')
  })

  it('draws one duplicate group per weekend when a guest filed twice for each', () => {
    // A person can be enrolled in two adult weekends; the API returns one
    // group per (person, weekend), so the person alone is not a unique key.
    const data = queue.data as { duplicates: Array<Record<string, unknown>> }
    const first = data.duplicates[0]!
    data.duplicates.push({ ...first, session_cm_id: 1000003, change_kind: 'identical' })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<JotformPanel />)
    expect(screen.getAllByTestId('jotform-duplicate-1000004')).toHaveLength(2)
    const keyWarnings = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes('same key')
    )
    expect(keyWarnings).toEqual([])
  })
})
