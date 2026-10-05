/** Use X's Form (round 3, section 3): the strip above the disagreeing answers, and the hold banner's buttons. */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidHouseholdPage, ApiAidUseFormOut } from '../../../types/api-types'
import { ROW_EMMA } from '../requests/gridFixtures'
import { householdPage, householdRequest } from './householdFixtures'
import { income } from './sectionsFixtures'
import { UseFormButtons, UseFormStrip } from './UseFormControls'
import { useFormsControl } from './useFormsControl'

const spy = vi.fn()
let outcome: Promise<unknown> | null = null
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidUseForm: () => ({
    isPending: false,
    error: null,
    mutateAsync: (vars: unknown) => {
      spy(vars)
      return outcome ?? Promise.resolve(wrote())
    },
  }),
}))

function wrote(over: Partial<ApiAidUseFormOut> = {}): ApiAidUseFormOut {
  return {
    household_cm_id: 1000001,
    person_cm_id: 1000002,
    operation_id: 'op0000000000009',
    applied: [
      'total_gross_income',
      'expected_gross_income',
      'total_housing_expenses',
      'num_children',
    ].map((field, i) => ({
      id: `cor00000000000${String(i)}`,
      field,
      request_id: '',
      new_value: '1',
      original_value: '2',
      reason: '',
      actor: 'test@example.com',
      created: '',
    })),
    skipped_blank: [],
    unchanged: [],
    still_disagreeing: [],
    ...over,
  }
}

/** Emma's form (1000002) and Samuel's (1000010) disagree on three income answers and the children. */
const flags = (resolved = false) => [
  {
    code: 'income_conflict',
    detail: {
      fields: {
        total_gross_income: [
          { value: 84000, person_cm_ids: [1000002] },
          { value: 88000, person_cm_ids: [1000010] },
        ],
        expected_gross_income: [
          { value: 86500, person_cm_ids: [1000002] },
          { value: 90000, person_cm_ids: [1000010] },
        ],
        total_housing_expenses: [
          { value: 30000, person_cm_ids: [1000002] },
          { value: 36000, person_cm_ids: [1000010] },
        ],
      },
      resolved_by_correction: resolved,
    },
  },
  {
    code: 'household_answer_conflict',
    detail: {
      fields: {
        num_children: [
          { value: 3, person_cm_ids: [1000002] },
          { value: 2, person_cm_ids: [1000010] },
        ],
      },
      resolved_by_correction: resolved,
    },
  },
]

const HELD = householdRequest({
  ...ROW_EMMA,
  holds: [
    { code: 'household_income_conflict', severity: 'hold', message: 'The applications differ' },
  ],
})
const pageWith = (incomeFlags: ReturnType<typeof flags> | []): ApiAidHouseholdPage =>
  householdPage({ incomes: [income({ flags: incomeFlags })] })

/** The page's one control, shared by the banner and the strip, as the household page holds it. */
function Harness({ page }: { page: ApiAidHouseholdPage }) {
  const control = useFormsControl(page)
  return (
    <>
      <div data-testid="banner">
        <UseFormButtons page={page} request={HELD} control={control} />
      </div>
      <div data-testid="strip">
        <UseFormStrip page={page} income={page.incomes[0]!} control={control} />
      </div>
    </>
  )
}

const within = (where: string, name: string) =>
  Array.from(screen.getByTestId(where).querySelectorAll('button')).find(
    (b) => b.textContent === name
  )!
const inBanner = (name: string) => within('banner', name)
const inStrip = (name: string) => within('strip', name)

beforeEach(() => {
  spy.mockReset()
  outcome = null
})

describe("Use X's Form: shown only for an open conflict, one button per form", () => {
  it('shows nothing with no conflict flag', () => {
    render(<Harness page={pageWith([])} />)
    expect(screen.queryByRole('button', { name: /^Use .*'s Form$/ })).toBeNull()
    expect(screen.getByTestId('strip')).toBeEmptyDOMElement()
  })

  it('shows nothing once the flags are resolved', () => {
    render(<Harness page={pageWith(flags(true))} />)
    expect(screen.queryByRole('button', { name: /^Use .*'s Form$/ })).toBeNull()
  })

  it('puts one button per form in the banner and in the strip, with the strip’s words', () => {
    render(<Harness page={pageWith(flags())} />)
    expect(screen.getAllByRole('button', { name: "Use Emma's Form" })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: "Use Samuel's Form" })).toHaveLength(2)
    expect(screen.getByTestId('strip')).toHaveTextContent(
      "4 answers disagree between Emma's form and Samuel's form."
    )
    expect(screen.getByLabelText('Reason (optional)')).toBeInTheDocument()
  })

  it('puts no buttons on a banner whose household has no open conflict', () => {
    const page = householdPage({
      incomes: [income({ household_cm_id: 1000003, flags: flags() })],
    })
    render(<Harness page={page} />)
    expect(screen.getByTestId('banner')).toBeEmptyDOMElement()
  })
})

describe("Use X's Form: one click, one POST", () => {
  it('sends the strip’s reason with the strip’s button', async () => {
    render(<Harness page={pageWith(flags())} />)
    await userEvent.type(screen.getByLabelText('Reason (optional)'), ' Emma’s form is newer ')
    await userEvent.click(inStrip("Use Emma's Form"))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({
      year: 2027,
      householdCmId: 1000001,
      body: { person_cm_id: 1000002, reason: 'Emma’s form is newer' },
    })
  })

  it('sends the strip’s reason from the banner when one is typed, and an empty one when not', async () => {
    const { unmount } = render(<Harness page={pageWith(flags())} />)
    await userEvent.click(inBanner("Use Samuel's Form"))
    expect(spy).toHaveBeenLastCalledWith({
      year: 2027,
      householdCmId: 1000001,
      body: { person_cm_id: 1000010, reason: '' },
    })
    unmount()
    render(<Harness page={pageWith(flags())} />)
    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'Called the family')
    await userEvent.click(inBanner("Use Emma's Form"))
    expect(spy).toHaveBeenLastCalledWith({
      year: 2027,
      householdCmId: 1000001,
      body: { person_cm_id: 1000002, reason: 'Called the family' },
    })
  })

  it('sends once while one is outstanding, every button disabled', async () => {
    let settle: (value: unknown) => void = () => undefined
    outcome = new Promise((resolve) => {
      settle = resolve
    })
    render(<Harness page={pageWith(flags())} />)
    const button = inStrip("Use Emma's Form")
    act(() => {
      button.click()
      button.click()
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(inBanner("Use Samuel's Form")).toBeDisabled()
    await act(async () => {
      settle(wrote())
      await outcome
    })
    expect(inStrip("Use Emma's Form")).not.toBeDisabled()
  })
})

describe("Use X's Form: what it did, said where it was clicked", () => {
  it('says how many answers it used the form for', async () => {
    render(<Harness page={pageWith(flags())} />)
    await userEvent.click(inStrip("Use Emma's Form"))
    expect(await screen.findByText("Used Emma's form for 4 answers.")).toBeInTheDocument()
  })

  it('says there was nothing to change when it wrote nothing', async () => {
    outcome = Promise.resolve(
      wrote({ operation_id: '', applied: [], unchanged: ['total_gross_income'] })
    )
    render(<Harness page={pageWith(flags())} />)
    await userEvent.click(inStrip("Use Emma's Form"))
    expect(
      await screen.findByText("Nothing to change: every answer already matches Emma's form.")
    ).toBeInTheDocument()
  })

  it('names the answers the form left blank and the other form to use', async () => {
    outcome = Promise.resolve(wrote({ skipped_blank: ['total_medical_expenses'] }))
    render(<Harness page={pageWith(flags())} />)
    await userEvent.click(inStrip("Use Emma's Form"))
    expect(
      await screen.findByText(
        "Emma's form left Medical expenses blank: correct it by hand or use Samuel's."
      )
    ).toBeInTheDocument()
  })

  it("shows the server's refusal as sent, beside the banner that sent it", async () => {
    outcome = Promise.reject(new Error('that form leaves every disagreeing answer blank'))
    outcome.catch(() => undefined)
    render(<Harness page={pageWith(flags())} />)
    await userEvent.click(inBanner("Use Emma's Form"))
    expect(
      await screen.findAllByText('that form leaves every disagreeing answer blank')
    ).not.toHaveLength(0)
    expect(screen.getByTestId('banner')).toHaveTextContent(
      'that form leaves every disagreeing answer blank'
    )
  })

  it('keeps what it did in the Income tab once the conflict is gone', async () => {
    const { rerender } = render(<Harness page={pageWith(flags())} />)
    await userEvent.click(inStrip("Use Emma's Form"))
    rerender(<Harness page={pageWith(flags(true))} />)
    expect(screen.getByTestId('strip')).toHaveTextContent("Used Emma's form for 4 answers.")
    expect(screen.queryByRole('button', { name: /^Use .*'s Form$/ })).toBeNull()
  })
})
