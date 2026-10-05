import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, ROW_EMMA } from '../requests/gridFixtures'
import {
  DuplicateForm,
  HeadcountForm,
  IncomeCorrection,
  SessionForm,
  ShareForm,
} from './CaseworkForms'
import { createEditorExits } from './editorExits'
import { answerWords } from './householdModel'
import {
  applicationOut,
  householdPage,
  householdRequest,
  requestOut,
  SPLIT_PAGE,
} from './householdFixtures'

const spies = {
  correction: vi.fn(),
  share: vi.fn(),
  session: vi.fn(),
  duplicate: vi.fn(),
  headcount: vi.fn(),
}
// What the next write does: settle at once, wait for the test, or be refused.
let outcome: Promise<unknown> | null = null
// Typed as a plain function: vitest 5's `Mock` type isn't callable under tsc (I1).
const writing = (spy: (vars: unknown) => unknown) => ({
  isPending: false,
  error: null,
  mutateAsync: (vars: unknown) => {
    spy(vars)
    return outcome ?? Promise.resolve({})
  },
})
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidCorrection: () => writing(spies.correction),
  useAidHouseholdShare: () => writing(spies.share),
  useAidSessionResolve: () => writing(spies.session),
  useAidDuplicate: () => writing(spies.duplicate),
  useAidHeadcount: () => writing(spies.headcount),
}))
let application: ReturnType<typeof applicationOut> | undefined = applicationOut()
let applicationError: Error | null = null
let applicationLoading = false
vi.mock('../../../hooks/camperships/useAidApplication', () => ({
  useAidApplication: () => ({
    data: application,
    isLoading: applicationLoading,
    error: applicationError,
  }),
}))

const PAGE = householdPage()
const done = vi.fn()
const countAnswer = () => {
  const income = PAGE.incomes[0]!
  return { income, answer: income.answers.find((a) => a.field === 'num_children')! }
}

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockReset()
  done.mockReset()
  outcome = null
  application = applicationOut()
  applicationError = null
  applicationLoading = false
})

describe('IncomeCorrection (main spec §9.3)', () => {
  it('corrects a count with its reason', async () => {
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={answer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.clear(screen.getByLabelText('Children'))
    await userEvent.type(screen.getByLabelText('Children'), '4')
    await userEvent.type(screen.getByLabelText('Reason'), 'Confirmed by phone{Enter}')
    expect(spies.correction).toHaveBeenCalledWith({
      year: 2027,
      householdCmId: 1000001,
      body: { field: 'num_children', new_value: '4', reason: 'Confirmed by phone' },
    })
  })

  it("goes back to the form's figure on a corrected answer, sending null (the server 422s on '')", async () => {
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={{ ...answer, corrected: true }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'The family was right')
    await userEvent.click(screen.getByRole('button', { name: "Use the Form's Figure" }))
    expect(spies.correction).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { field: 'num_children', new_value: null, reason: 'The family was right' },
      })
    )
  })

  it('renders a yes/no answer as a Yes/No select and sends the flag as a string (m5)', async () => {
    const { income } = countAnswer()
    const flag = {
      field: 'single_parent',
      synced: 'true',
      effective: 'true',
      corrected: false,
      changed_since_correction: false,
      history: [],
    }
    render(<IncomeCorrection page={PAGE} income={income} answer={flag} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.selectOptions(screen.getByLabelText(answerWords('single_parent')), 'false')
    await userEvent.type(screen.getByLabelText('Reason'), 'Not single after all{Enter}')
    expect(spies.correction).toHaveBeenCalledWith({
      year: 2027,
      householdCmId: 1000001,
      body: { field: 'single_parent', new_value: 'false', reason: 'Not single after all' },
    })
  })

  it('renders a money answer as a text input and sends the figure as plain digits (m5)', async () => {
    const { income } = countAnswer()
    const money = {
      field: 'total_rent',
      synced: '900.00',
      effective: '900.00',
      corrected: false,
      changed_since_correction: false,
      history: [],
    }
    render(<IncomeCorrection page={PAGE} income={income} answer={money} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    const input = screen.getByLabelText(answerWords('total_rent'))
    expect(input.tagName).toBe('INPUT')
    await userEvent.clear(input)
    await userEvent.type(input, '$1,200,000')
    await userEvent.type(screen.getByLabelText('Reason'), 'Lease on file{Enter}')
    expect(spies.correction).toHaveBeenCalledWith({
      year: 2027,
      householdCmId: 1000001,
      body: { field: 'total_rent', new_value: '1200000', reason: 'Lease on file' },
    })
  })

  it('offers the way back only on a corrected answer, and nothing on the income override', async () => {
    const { income, answer } = countAnswer()
    const { rerender } = render(
      <IncomeCorrection page={PAGE} income={income} answer={{ ...answer, corrected: false }} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    expect(screen.queryByRole('button', { name: "Use the Form's Figure" })).toBeNull()
    rerender(
      <IncomeCorrection
        page={PAGE}
        income={income}
        answer={{
          ...answer,
          field: 'income_override',
          synced: 'confirmed_prior_year',
          effective: 'confirmed_prior_year',
        }}
      />
    )
    expect(screen.queryByRole('button', { name: 'Correct…' })).toBeNull()
  })

  it('asks for a figure the server can read before sending anything, with or without a reason', async () => {
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={answer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.clear(screen.getByLabelText('Children'))
    await userEvent.type(screen.getByLabelText('Children'), '4.5')
    await userEvent.click(screen.getByRole('button', { name: 'Save the Correction' }))
    expect(screen.getByText('A whole number')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Reason'), 'x{Enter}')
    expect(screen.getByText('A whole number')).toBeInTheDocument()
    expect(spies.correction).not.toHaveBeenCalled()
  })

  it('saves with no reason, sending it empty (Reason is optional: owner ruling 10-05)', async () => {
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={answer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.clear(screen.getByLabelText('Children'))
    await userEvent.type(screen.getByLabelText('Children'), '4')
    await userEvent.type(screen.getByLabelText('Reason'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Save the Correction' }))
    expect(screen.queryByText('A reason is required')).toBeNull()
    expect(spies.correction).toHaveBeenCalledWith({
      year: 2027,
      householdCmId: 1000001,
      body: { field: 'num_children', new_value: '4', reason: '' },
    })
  })

  it("shows the server's refusal and keeps the form and what was typed", async () => {
    outcome = Promise.reject(new Error('a reason is required'))
    outcome.catch(() => undefined)
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={answer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Confirmed by phone{Enter}')
    expect(await screen.findByText('a reason is required')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toHaveValue('Confirmed by phone')
  })

  it('sends once while a save is outstanding, and closes only after it settles', async () => {
    let settle: () => void = () => undefined
    outcome = new Promise<void>((resolve) => {
      settle = resolve
    })
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={answer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Confirmed by phone')
    // Two submits in one tick, before any re-render could disable the button: only the ref stops the second.
    const form = screen.getByLabelText('Reason').closest('form')!
    act(() => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })
    expect(spies.correction).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Save the Correction' })).toBeDisabled()
    await act(async () => {
      settle()
      await outcome
    })
    expect(screen.queryByLabelText('Reason')).toBeNull()
  })

  it('keeps the form open while a save is outstanding: Back is disabled and Esc does nothing', async () => {
    outcome = new Promise<void>(() => undefined)
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={answer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Confirmed by phone')
    act(() => {
      fireEvent.submit(screen.getByLabelText('Reason').closest('form')!)
    })
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('Reason'), { key: 'Escape' })
    expect(screen.getByLabelText('Reason')).toBeInTheDocument()
  })

  it('reopens from the answer as it stands, with a blank reason, after Back', async () => {
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={answer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.clear(screen.getByLabelText('Children'))
    await userEvent.type(screen.getByLabelText('Children'), '9')
    await userEvent.type(screen.getByLabelText('Reason'), 'half-typed')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    expect(screen.getByLabelText('Children')).toHaveValue(answer.effective)
    expect(screen.getByLabelText('Reason')).toHaveValue('')
  })

  it("leaves the page's open editor before opening (one open editor per page)", async () => {
    const exits = createEditorExits()
    const left = vi.fn()
    exits.register('reqemma00000001', (go) => {
      left()
      go()
    })
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={answer} exits={exits} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    expect(left).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Reason')).toBeInTheDocument()
  })
})

describe('ShareForm (main spec §9.2)', () => {
  it("sets another household's share as a percentage", async () => {
    render(<ShareForm request={SPLIT_PAGE.requests[0]!} page={SPLIT_PAGE} onDone={done} />)
    await userEvent.selectOptions(screen.getByLabelText('Household'), '1000003')
    await userEvent.type(screen.getByLabelText('Share'), '40')
    await userEvent.type(screen.getByLabelText('Reason'), 'Parents agreed 60/40{Enter}')
    expect(spies.share).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      householdCmId: 1000003,
      body: { share_pct: '40', reason: 'Parents agreed 60/40' },
    })
  })

  it('takes a percentage only: no dollar unit, and a typed amount is refused as not a percentage', async () => {
    render(<ShareForm request={SPLIT_PAGE.requests[0]!} page={SPLIT_PAGE} onDone={done} />)
    expect(screen.queryByLabelText('Share as')).toBeNull()
    await userEvent.type(screen.getByLabelText('Share'), '140')
    await userEvent.type(screen.getByLabelText('Reason'), 'Typo{Enter}')
    expect(screen.getByText('At most 100%')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Share'))
    await userEvent.type(screen.getByLabelText('Share'), '$880{Enter}')
    expect(screen.getByText('A percentage, like 40 or 62.5')).toBeInTheDocument()
    expect(spies.share).not.toHaveBeenCalled()
  })

  it('adds a household that is not on the page by its CampMinder id', async () => {
    render(<ShareForm request={SPLIT_PAGE.requests[0]!} page={SPLIT_PAGE} onDone={done} />)
    await userEvent.selectOptions(screen.getByLabelText('Household'), 'other')
    await userEvent.type(screen.getByLabelText('Household id'), '1000099')
    await userEvent.type(screen.getByLabelText('Share'), '25')
    await userEvent.type(screen.getByLabelText('Reason'), 'Third payer{Enter}')
    expect(spies.share).toHaveBeenCalledWith(
      expect.objectContaining({
        householdCmId: 1000099,
        body: { share_pct: '25', reason: 'Third payer' },
      })
    )
  })

  it('shows the percent unit and says what the server does with the other share (m2)', () => {
    render(<ShareForm request={householdRequest(ROW_EMMA)} page={SPLIT_PAGE} onDone={done} />)
    expect(screen.getByText('%')).toBeInTheDocument()
    expect(
      screen.getByText(
        "With one other household on this request, this tool fills the other household's share.",
        { exact: false }
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/holds .* until a second share is added/i)).toBeInTheDocument()
  })

  it('refuses a share of nothing before asking the server', async () => {
    render(<ShareForm request={SPLIT_PAGE.requests[0]!} page={SPLIT_PAGE} onDone={done} />)
    await userEvent.type(screen.getByLabelText('Share'), '0')
    await userEvent.type(screen.getByLabelText('Reason'), 'x{Enter}')
    expect(screen.getByText('More than 0%')).toBeInTheDocument()
    expect(spies.share).not.toHaveBeenCalled()
  })

  it("shows the server's refusal and stays open; done only on success", async () => {
    outcome = Promise.reject(new Error('a withdrawn request has no payers to set'))
    outcome.catch(() => undefined)
    render(<ShareForm request={SPLIT_PAGE.requests[0]!} page={SPLIT_PAGE} onDone={done} />)
    await userEvent.type(screen.getByLabelText('Share'), '50')
    await userEvent.type(screen.getByLabelText('Reason'), 'Split{Enter}')
    expect(await screen.findByText('a withdrawn request has no payers to set')).toBeInTheDocument()
    expect(done).not.toHaveBeenCalled()
  })

  it('closes after the write has settled, and Back closes without writing', async () => {
    render(<ShareForm request={SPLIT_PAGE.requests[0]!} page={SPLIT_PAGE} onDone={done} />)
    await userEvent.type(screen.getByLabelText('Share'), '40')
    await userEvent.type(screen.getByLabelText('Reason'), 'ok{Enter}')
    expect(done).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(spies.share).toHaveBeenCalledTimes(1)
  })
})

describe('SessionForm, DuplicateForm, HeadcountForm', () => {
  // The candidates come on the row (GridRowOut.session_candidates), named by the server.
  const UNSETTLED = gridRow({
    ...ROW_EMMA,
    request_status: 'unmatched_session',
    session_candidates: [
      { session_cm_id: 1000101, name: 'Session 2' },
      { session_cm_id: 1000199, name: 'Session 3' },
    ],
  })

  it('settles the session from the candidates on the row, with no application read', async () => {
    application = undefined
    render(<SessionForm request={householdRequest(UNSETTLED)} onDone={done} />)
    expect(screen.getByRole('option', { name: 'Session 3' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Session'), '1000101')
    await userEvent.type(screen.getByLabelText('Reason'), 'Registered for Session 2{Enter}')
    expect(spies.session).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { session_cm_id: 1000101, reason: 'Registered for Session 2' },
    })
  })

  it('says so when intake recorded no candidates', () => {
    render(
      <SessionForm
        request={householdRequest({ ...UNSETTLED, session_candidates: [] })}
        onDone={done}
      />
    )
    expect(
      screen.getByText('No candidate sessions are recorded for this request.')
    ).toBeInTheDocument()
  })

  it('keeps the other request and marks this one its duplicate', async () => {
    const duplicate = householdRequest(
      gridRow({ request_id: 'reqemmadup00009', request_status: 'duplicate_pending' })
    )
    const page = householdPage({ requests: [householdRequest(ROW_EMMA), duplicate] })
    render(<DuplicateForm request={duplicate} page={page} onDone={done} />)
    await userEvent.type(screen.getByLabelText('Reason'), 'Sent twice{Enter}')
    expect(spies.duplicate).toHaveBeenCalledWith({
      requestId: 'reqemmadup00009',
      body: { duplicate_of: 'reqemma00000001', reason: 'Sent twice' },
    })
  })

  it("also offers the holder intake named when it is on another household's page (§9.2)", async () => {
    const pending = householdRequest(
      gridRow({ request_id: 'reqemmadup00009', request_status: 'duplicate_pending' })
    )
    application = applicationOut({
      requests: [
        requestOut({
          id: 'reqemmadup00009',
          status: 'duplicate_pending',
          duplicate_of: 'reqemmaother01',
        }),
      ],
    })
    render(
      <DuplicateForm
        request={pending}
        page={householdPage({ requests: [pending] })}
        onDone={done}
      />
    )
    expect(
      screen.getByRole('option', { name: 'the request intake named · reqemmaother01' })
    ).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Reason'), 'Second parent filed it{Enter}')
    expect(spies.duplicate).toHaveBeenCalledWith({
      requestId: 'reqemmadup00009',
      body: { duplicate_of: 'reqemmaother01', reason: 'Second parent filed it' },
    })
  })

  it('says the read failed, not that nothing is on the page, when the application could not be read (m3)', async () => {
    const lone = householdRequest(
      gridRow({ request_id: 'reqemmadup00009', request_status: 'duplicate_pending' })
    )
    const page = householdPage({ requests: [lone] })
    application = undefined
    applicationError = new Error('x')
    render(<DuplicateForm request={lone} page={page} onDone={done} />)
    expect(
      screen.getByText("Couldn't load the request intake named for this one.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/on this page/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(done).toHaveBeenCalled()
  })

  it('gives the loading lines a Back (m3)', async () => {
    const lone = householdRequest(
      gridRow({ request_id: 'reqemmadup00009', request_status: 'duplicate_pending' })
    )
    application = undefined
    applicationLoading = true
    const { unmount } = render(
      <DuplicateForm request={lone} page={householdPage({ requests: [lone] })} onDone={done} />
    )
    expect(screen.getByText('Looking for the request to keep…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(done).toHaveBeenCalledTimes(1)
    unmount()
    const family = householdRequest(
      gridRow({ request_id: 'reqfamily000010', person_cm_id: 0, camper_name: '' })
    )
    render(<HeadcountForm request={family} page={PAGE} onDone={done} />)
    expect(screen.getByText('Loading the headcount…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(done).toHaveBeenCalledTimes(2)
  })

  it('does not list the named holder twice when it is on the page', () => {
    const pending = householdRequest(
      gridRow({ request_id: 'reqemmadup00009', request_status: 'duplicate_pending' })
    )
    application = applicationOut({
      requests: [requestOut({ id: 'reqemmadup00009', duplicate_of: 'reqemma00000001' })],
    })
    const page = householdPage({ requests: [householdRequest(ROW_EMMA), pending] })
    render(<DuplicateForm request={pending} page={page} onDone={done} />)
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('sets a Family Camp headcount, starting from what the application holds', async () => {
    application = applicationOut({
      requests: [
        requestOut({
          id: 'reqfamily000010',
          person_cm_id: 0,
          headcount_non_infant: 2,
          headcount_infant: 1,
        }),
      ],
    })
    const family = householdRequest(
      gridRow({ request_id: 'reqfamily000010', person_cm_id: 0, camper_name: '' })
    )
    render(<HeadcountForm request={family} page={PAGE} onDone={done} />)
    expect(screen.getByLabelText('Not infants')).toHaveValue('2')
    await userEvent.clear(screen.getByLabelText('Not infants'))
    await userEvent.type(screen.getByLabelText('Not infants'), '3')
    await userEvent.type(screen.getByLabelText('Reason'), 'Billing shows three{Enter}')
    expect(spies.headcount).toHaveBeenCalledWith({
      requestId: 'reqfamily000010',
      body: { non_infant: 3, infant: 1, source: 'override', reason: 'Billing shows three' },
    })
  })

  it('shows a note, and no fields, when the headcount could not be read', () => {
    const family = householdRequest(
      gridRow({ request_id: 'reqfamily000010', person_cm_id: 0, camper_name: '' })
    )
    application = undefined
    const { unmount } = render(<HeadcountForm request={family} page={PAGE} onDone={done} />)
    expect(screen.getByText("Couldn't load this request's headcount.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Not infants')).toBeNull()
    unmount()
    // Read, but the request is not in it.
    application = applicationOut({ requests: [requestOut({ id: 'reqother0000099' })] })
    render(<HeadcountForm request={family} page={PAGE} onDone={done} />)
    expect(screen.getByText("Couldn't load this request's headcount.")).toBeInTheDocument()
  })

  describe("the season's reason codes (Decision 6: what the page's override_reasons offers)", () => {
    const CODES = householdPage({ override_reasons: ['headcount', 'discount'] })
    const family = householdRequest(
      gridRow({ request_id: 'reqfamily000010', person_cm_id: 0, camper_name: '' })
    )
    beforeEach(() => {
      application = applicationOut({
        requests: [
          requestOut({
            id: 'reqfamily000010',
            person_cm_id: 0,
            headcount_non_infant: 2,
            headcount_infant: 1,
          }),
        ],
      })
    })

    it('offers the codes as the server sends them, and sends the one picked as reason_code', async () => {
      render(<HeadcountForm request={family} page={CODES} onDone={done} />)
      expect(screen.getByRole('option', { name: 'discount' })).toBeInTheDocument()
      await userEvent.selectOptions(screen.getByLabelText('Reason code'), 'headcount')
      await userEvent.type(screen.getByLabelText('Reason'), 'Billing shows three{Enter}')
      expect(spies.headcount).toHaveBeenCalledWith({
        requestId: 'reqfamily000010',
        body: {
          non_infant: 2,
          infant: 1,
          source: 'override',
          reason: 'Billing shows three',
          reason_code: 'headcount',
        },
      })
    })

    it('asks for a code before sending when the season offers any', async () => {
      render(<HeadcountForm request={family} page={CODES} onDone={done} />)
      await userEvent.type(screen.getByLabelText('Reason'), 'Billing shows three{Enter}')
      expect(screen.getByText('Pick a reason code')).toBeInTheDocument()
      expect(spies.headcount).not.toHaveBeenCalled()
    })

    it('offers no picker, and sends no code, when the page carries none', () => {
      render(<HeadcountForm request={family} page={householdPage()} onDone={done} />)
      expect(screen.queryByLabelText('Reason code')).toBeNull()
    })
  })

  it('refuses a family of nobody before asking the server', async () => {
    const family = householdRequest(
      gridRow({ request_id: 'reqfamily000010', person_cm_id: 0, camper_name: '' })
    )
    application = applicationOut({
      requests: [requestOut({ id: 'reqfamily000010', person_cm_id: 0 })],
    })
    render(<HeadcountForm request={family} page={PAGE} onDone={done} />)
    await userEvent.type(screen.getByLabelText('Reason'), 'none{Enter}')
    expect(screen.getByText('A family needs at least one person')).toBeInTheDocument()
    expect(spies.headcount).not.toHaveBeenCalled()
  })
})

describe('every casework form closes on Esc as soon as it opens', () => {
  // The key goes to whatever has focus, with no click first: a form that never takes focus
  // leaves Esc on <body>, where nothing hears it.
  const esc = async (open: () => void) => {
    open()
    await userEvent.keyboard('{Escape}')
    expect(done).toHaveBeenCalledTimes(1)
  }

  it('Correct… (a count)', async () => {
    const { income, answer } = countAnswer()
    render(<IncomeCorrection page={PAGE} income={income} answer={answer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByLabelText('Reason')).toBeNull()
  })

  it('Payer Shares…', async () => {
    await esc(() =>
      render(<ShareForm request={SPLIT_PAGE.requests[0]!} page={SPLIT_PAGE} onDone={done} />)
    )
  })

  it('Settle Session…', async () => {
    const unsettled = gridRow({
      ...ROW_EMMA,
      request_status: 'unmatched_session',
      session_candidates: [{ session_cm_id: 1000101, name: 'Session 2' }],
    })
    await esc(() => render(<SessionForm request={householdRequest(unsettled)} onDone={done} />))
  })

  it('Keep the Other Request…', async () => {
    const duplicate = householdRequest(
      gridRow({ request_id: 'reqemmadup00009', request_status: 'duplicate_pending' })
    )
    const page = householdPage({ requests: [householdRequest(ROW_EMMA), duplicate] })
    await esc(() => render(<DuplicateForm request={duplicate} page={page} onDone={done} />))
  })

  it('Headcount…', async () => {
    const family = householdRequest(
      gridRow({ request_id: 'reqfamily000010', person_cm_id: 0, camper_name: '' })
    )
    application = applicationOut({
      requests: [requestOut({ id: 'reqfamily000010', person_cm_id: 0 })],
    })
    await esc(() => render(<HeadcountForm request={family} page={PAGE} onDone={done} />))
  })
})

describe("every casework form's message-only state closes on Esc as soon as it opens", () => {
  // As the forms above: the key goes to whatever has focus, with no click first.
  const lone = () =>
    householdRequest(
      gridRow({ request_id: 'reqemmadup00009', request_status: 'duplicate_pending' })
    )
  const family = () =>
    householdRequest(gridRow({ request_id: 'reqfamily000010', person_cm_id: 0, camper_name: '' }))
  const escCloses = async (text: string) => {
    expect(screen.getByText(text)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(done).toHaveBeenCalledTimes(1)
  }

  it('Settle Session…: no candidate sessions', async () => {
    render(
      <SessionForm
        request={householdRequest(
          gridRow({ ...ROW_EMMA, request_status: 'unmatched_session', session_candidates: [] })
        )}
        onDone={done}
      />
    )
    await escCloses('No candidate sessions are recorded for this request.')
  })

  it('Keep the Other Request…: still looking', async () => {
    application = undefined
    applicationLoading = true
    render(
      <DuplicateForm request={lone()} page={householdPage({ requests: [lone()] })} onDone={done} />
    )
    await escCloses('Looking for the request to keep…')
  })

  it("Keep the Other Request…: couldn't load", async () => {
    application = undefined
    applicationError = new Error('x')
    render(
      <DuplicateForm request={lone()} page={householdPage({ requests: [lone()] })} onDone={done} />
    )
    await escCloses("Couldn't load the request intake named for this one.")
  })

  it('Keep the Other Request…: nothing to keep', async () => {
    render(
      <DuplicateForm request={lone()} page={householdPage({ requests: [lone()] })} onDone={done} />
    )
    await escCloses('No other active request for this camper and session is on this page.')
  })

  it('Headcount…: loading', async () => {
    application = undefined
    applicationLoading = true
    render(<HeadcountForm request={family()} page={PAGE} onDone={done} />)
    await escCloses('Loading the headcount…')
  })

  it("Headcount…: couldn't load", async () => {
    application = undefined
    render(<HeadcountForm request={family()} page={PAGE} onDone={done} />)
    await escCloses("Couldn't load this request's headcount.")
  })
})
