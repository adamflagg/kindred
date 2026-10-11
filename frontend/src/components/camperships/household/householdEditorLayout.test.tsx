/**
 * The household request-card editors on the kit grid (owner 10-10; conformance.html #g6-*): every
 * field is an EditorField (its label BESIDE it, never above), in the grid each mock draws, inside the
 * one HouseholdForm card. These pin the layout only; what each form saves is pinned beside the form.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { aidPicker, chooseAid } from '../../../test/aidPicker'
import { CS_FGRID, CS_FGRID_PAYER, CS_FGRID_TWO } from '../kit/csType'
import { gridRow, roundOut, ROW_EMMA } from '../requests/gridFixtures'
import { CancelForm } from './CancelForm'
import {
  DuplicateForm,
  HeadcountForm,
  IncomeCorrection,
  KeepThisForm,
  SessionForm,
  ShareForm,
} from './CaseworkForms'
import { householdPage, householdRequest, SPLIT_PAGE } from './householdFixtures'
import { ClearCostForm, SetCostForm } from './SetCostForm'
import { income } from './sectionsFixtures'

vi.mock('../../../hooks/camperships/useAidWrites', () => {
  const write = () => ({ isPending: false, error: null, mutateAsync: () => Promise.resolve({}) })
  return {
    useAidCorrection: write,
    useAidHouseholdShare: write,
    useAidSessionResolve: write,
    useAidDuplicate: write,
    useAidHeadcount: write,
    useAidCostOverride: write,
  }
})
vi.mock('../../../hooks/camperships/useAidApplication', async () => {
  const { applicationOut, requestOut } = await import('./householdFixtures')
  const data = applicationOut({
    requests: [
      requestOut({
        id: 'reqfamily000010',
        person_cm_id: 0,
        headcount_non_infant: 4,
        headcount_infant: 1,
      }),
    ],
  })
  return { useAidApplication: () => ({ data, isLoading: false, error: null }) }
})

const done = vi.fn()
beforeEach(() => done.mockReset())

const grid = () => screen.getByTestId('aid-editor-grid')
/** The grid's label cells, in order: the muted span before each field. */
const labels = () =>
  Array.from(grid().children)
    .filter((cell) => (cell.tagName === 'SPAN' || cell.tagName === 'LABEL') && cell.className.includes('text-muted-foreground'))
    .map((cell) => cell.textContent)
const side = () => document.querySelector('[data-editor-side]') as HTMLElement
const box = () => document.querySelector('[data-editor-box]') as HTMLElement
/** The label span that sits directly before the field cell holding `control`. */
const labelBeside = (control: HTMLElement) => {
  const cell = control.closest('.min-w-0')
  return cell?.previousElementSibling?.textContent
}
/** Save, then Back, in one row (the ruled order), with the key hint at the row's end. */
const expectOneRow = (save: string) => {
  const button = screen.getByRole('button', { name: save })
  expect(button.nextElementSibling).toBe(screen.getByRole('button', { name: 'Back' }))
  expect(button.parentElement).toHaveTextContent('Enter saves · Esc cancels')
}

describe('Payer Shares… (#g6-shares)', () => {
  const open = () =>
    render(<ShareForm request={SPLIT_PAGE.requests[0]!} page={SPLIT_PAGE} onDone={done} />)

  it('draws the five-column payer grid: Household, Share and its % each in their own column', () => {
    open()
    expect(grid().className).toBe(CS_FGRID_PAYER)
    expect(CS_FGRID_PAYER).toContain('max-content_minmax(0,1fr)_max-content_72px_max-content')
    expect(labelBeside(screen.getByLabelText('Share'))).toBe('Share')
    expect(screen.getByLabelText('Share').parentElement?.nextElementSibling).toHaveTextContent('%')
    expect(labels()).toEqual(
      expect.arrayContaining(['Household', 'Share', 'CampMinder id', 'Reason'])
    )
    expectOneRow('Set the Share')
  })

  it('keeps the CampMinder id on screen, dimmed and disabled, until Another household… is picked', async () => {
    open()
    const id = screen.getByLabelText('Household id')
    expect(id).toBeDisabled()
    expect(id.closest('.min-w-0')?.previousElementSibling).toHaveClass('opacity-50')
    await chooseAid('Household', 'Another household…')
    expect(screen.getByLabelText('Household id')).toBeEnabled()
    expect(id.closest('.min-w-0')?.previousElementSibling).not.toHaveClass('opacity-50')
  })

  it('has no label above a field: the old stacked captions are gone', () => {
    open()
    expect(box().querySelector('label')).toBeNull()
  })
})

describe('Set Cost… and Clear (#g6-cost, #g6-clear)', () => {
  const page = householdPage({ override_reasons: ['headcount', 'discount'] })
  const request = (over: Parameters<typeof gridRow>[0]) => householdRequest(gridRow(over))

  it('draws Cost and Reason on one row of the four-column grid, then Note across the rest', () => {
    render(
      <SetCostForm
        request={request({ rules_cost: 6695, rules_cost_from: 'catalog' })}
        page={page}
        onDone={done}
      />
    )
    expect(grid().className).toBe(CS_FGRID)
    expect(labels()).toEqual(['Cost', 'Reason', 'Note'])
    expect(labelBeside(screen.getByLabelText('Note'))).toBe('Note')
    expect(screen.getByLabelText('Note').closest('.min-w-0')).toHaveClass('col-[2/-1]')
    expectOneRow('Set the Cost')
  })

  it('keeps every contextual line in the right column, under "If you save"', async () => {
    render(
      <SetCostForm
        request={request({
          rules_cost: 6695,
          rules_cost_from: 'per_person',
          rounds: [roundOut(1, 'posted', { posted: 900 })],
        })}
        page={page}
        onDone={done}
      />
    )
    expect(side()).toHaveTextContent('If you save')
    expect(side()).toHaveTextContent('Type the cost to see it here')
    expect(side()).toHaveTextContent('Rounds not yet posted are worked out again on this cost.')
    expect(side()).toHaveTextContent('A round is already posted')
    await userEvent.type(screen.getByLabelText('Cost'), '1275')
    expect(side()).toHaveTextContent('$1,275 instead of $6,695, from the per-person rates')
    await chooseAid('Reason', 'Number of people')
    expect(side()).toHaveTextContent('To change who is counted, use Number of People… instead')
  })

  it('Clear: two columns, Why clear beside its field, the lead in the right column', () => {
    render(
      <ClearCostForm
        request={request({ rules_cost: 4800, rules_cost_from: 'catalog' })}
        page={page}
        onDone={done}
      />
    )
    expect(grid().className).toBe(CS_FGRID_TWO)
    expect(labelBeside(screen.getByLabelText('Why clear'))).toBe('Why clear')
    expect(side()).toHaveTextContent('Back to $4,800, the catalog price')
    expectOneRow('Clear the Cost')
  })
})

describe('Cancel Request… (#g6-cancel)', () => {
  const open = () =>
    render(
      <CancelForm
        initial={null}
        submitLabel="Cancel the Request"
        onSubmit={() => Promise.resolve()}
        onCancel={done}
      />
    )

  it('is a HouseholdForm: two columns, the reason picker in a 330px box, then Note', () => {
    open()
    expect(box().tagName).toBe('FORM')
    expect(grid().className).toBe(CS_FGRID_TWO)
    expect(labels()).toEqual(['Cancel reason', 'Note'])
    expect(aidPicker('Cancel reason').closest('.w-\\[330px\\]')).not.toBeNull()
    expect(side()).toHaveTextContent('A note is needed only for "another reason".')
    expectOneRow('Cancel the Request')
  })

  it('shows a refusal on the buttons row, after Back, and Esc goes back', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the Request' }))
    const refusal = screen.getByText('Pick a cancel reason')
    expect(screen.getByRole('button', { name: 'Back' }).nextElementSibling).toBe(refusal)
    await userEvent.keyboard('{Escape}')
    expect(done).toHaveBeenCalledTimes(1)
  })
})

describe('Settle Session…, Keep… and Keep This… (#g6-session, #g6-keep)', () => {
  it('Settle Session: two columns, Session then Reason, no right column', () => {
    render(
      <SessionForm
        request={householdRequest(
          gridRow({
            ...ROW_EMMA,
            request_status: 'unmatched_session',
            session_candidates: [{ session_cm_id: 1000101, name: 'Session 2' }],
          })
        )}
        onDone={done}
      />
    )
    expect(grid().className).toBe(CS_FGRID_TWO)
    expect(labels()).toEqual(['Session', 'Reason'])
    expect(side()).toBeNull()
    expectOneRow('Settle the Session')
  })

  it('Keep the Other Request (the picker): two columns, Keep then Reason', () => {
    const duplicate = householdRequest(
      gridRow({ request_id: 'reqemmadup00009', request_status: 'duplicate_pending' })
    )
    const page = householdPage({ requests: [householdRequest(ROW_EMMA), duplicate] })
    render(<DuplicateForm request={duplicate} page={page} onDone={done} />)
    expect(grid().className).toBe(CS_FGRID_TWO)
    expect(labels()).toEqual(['Keep', 'Reason'])
    expectOneRow('Mark as the Duplicate')
  })

  it('Keep This Request: two columns, Reason, and the other request named on the right', () => {
    render(
      <KeepThisForm
        request={householdRequest(ROW_EMMA)}
        otherId="reqother"
        otherName="Mia Dunn · Session 2"
        onDone={done}
      />
    )
    expect(grid().className).toBe(CS_FGRID_TWO)
    expect(labels()).toEqual(['Reason'])
    expect(side()).toHaveTextContent(
      'Marks the other request as the duplicate: Mia Dunn · Session 2'
    )
    expectOneRow('Mark the Other as the Duplicate')
  })

  it('a message-only state is an EditorForm with a Back button, not the old box', () => {
    render(
      <SessionForm
        request={householdRequest(
          gridRow({ ...ROW_EMMA, request_status: 'unmatched_session', session_candidates: [] })
        )}
        onDone={done}
      />
    )
    expect(screen.getByTestId('aid-editor-form')).toBeInTheDocument()
    expect(within(box()).getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(box().textContent).toContain('Settling the session')
  })
})

describe('Number of People… (#g6-people)', () => {
  it('draws the four-column grid: Not infants and Infants on one row, then Reason across', () => {
    const family = householdRequest(
      gridRow({ request_id: 'reqfamily000010', person_cm_id: 0, camper_name: '' })
    )
    render(<HeadcountForm request={family} onDone={done} />)
    expect(grid().className).toBe(CS_FGRID)
    expect(labels()).toEqual(['Not infants', 'Infants', 'Reason'])
    expect(side()).toBeNull()
    expectOneRow('Set the Number of People')
  })
})

describe('Correct… (#g6-correct)', () => {
  const FLAG = {
    code: 'income_conflict',
    detail: {
      fields: {
        total_housing_expenses: [
          { value: 30000, person_cm_ids: [1000002] },
          { value: 36000, person_cm_ids: [1000010] },
        ],
      },
      resolved_by_correction: false,
    },
  }
  const torn = income({ flags: [FLAG] })
  const page = householdPage({ incomes: [torn] })
  const housing = torn.answers.find((a) => a.field === 'total_housing_expenses')!

  it('Use is the kit segmented control (the picks plus Another figure); Used is 120px; Reason says optional', async () => {
    render(<IncomeCorrection page={page} income={torn} answer={housing} />)
    await userEvent.click(screen.getByRole('button', { name: 'Choose Which Form…' }))
    expect(grid().className).toBe(CS_FGRID)
    expect(labels()).toEqual(['Use', 'Used', 'Reason (optional)'])
    const use = screen.getByRole('group', { name: 'Use' })
    expect(
      within(use)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(["Emma's $30,000", "Samuel's $36,000", 'Another figure'])
    expect(within(use).getByRole('button', { name: 'Another figure' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByLabelText('Housing expenses')).toHaveClass('w-[120px]')
    await userEvent.click(within(use).getByRole('button', { name: "Samuel's $36,000" }))
    expect(within(use).getByRole('button', { name: "Samuel's $36,000" })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expectOneRow('Save the Correction')
  })

  it('"What it settles" sits in the buttons row, with the key hint, not in the fields', async () => {
    render(<IncomeCorrection page={page} income={torn} answer={housing} />)
    await userEvent.click(screen.getByRole('button', { name: 'Choose Which Form…' }))
    const settles = /This settles/
    const row = screen.getByRole('button', { name: 'Save the Correction' }).parentElement!
    expect(row).toHaveTextContent(settles)
    expect(row).toHaveTextContent('Enter saves · Esc cancels')
    expect(grid()).not.toHaveTextContent(settles)
  })

  it('a Yes/No answer is two columns, with the Yes/No picker compact', async () => {
    const flag = {
      field: 'single_parent',
      synced: 'true',
      effective: 'true',
      corrected: false,
      changed_since_correction: false,
      history: [],
    }
    render(<IncomeCorrection page={page} income={torn} answer={flag} />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    expect(grid().className).toBe(CS_FGRID_TWO)
    expect(labels()).toEqual(['Used', 'Reason (optional)'])
  })
})
