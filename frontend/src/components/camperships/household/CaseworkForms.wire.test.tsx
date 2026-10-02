/**
 * The correction form through the REAL write hook, down to what reaches `fetch` (Task 32 review I1):
 * the way back to the form's figure is `new_value: null`. An empty string is a 422 for every field kind.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { HeadcountForm, IncomeCorrection, ShareForm } from './CaseworkForms'
import {
  applicationOut,
  householdPage,
  householdRequest,
  requestOut,
  SPLIT_PAGE,
} from './householdFixtures'
import { gridRow } from '../requests/gridFixtures'

vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))

vi.mock('../../../hooks/camperships/useAidApplication', () => ({
  useAidApplication: () => ({
    data: applicationOut({
      requests: [
        requestOut({
          id: 'reqfamily000010',
          person_cm_id: 0,
          headcount_non_infant: 2,
          headcount_infant: 1,
        }),
      ],
    }),
    isLoading: false,
    error: null,
  }),
}))

const PAGE = householdPage()
let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })))
})
afterEach(() => fetchSpy.mockRestore())

function renderCorrection(corrected: boolean) {
  const income = PAGE.incomes[0]!
  const answer = income.answers.find((a) => a.field === 'num_children')!
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IncomeCorrection page={PAGE} income={income} answer={{ ...answer, corrected }} />
    </QueryClientProvider>
  )
}

const sentBody = () => {
  const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
  return { url, method: options.method, body: JSON.parse(options.body as string) as unknown }
}

describe('IncomeCorrection on the wire', () => {
  it("restores the form's figure with new_value null", async () => {
    renderCorrection(true)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'The family was right')
    await userEvent.click(screen.getByRole('button', { name: "Use the form's figure" }))
    const sent = sentBody()
    expect(sent.method).toBe('POST')
    expect(sent.url).toContain('1000001')
    expect(sent.body).toEqual({
      field: 'num_children',
      new_value: null,
      reason: 'The family was right',
    })
  })

  it('sends a corrected figure as plain text', async () => {
    renderCorrection(false)
    await userEvent.click(screen.getByRole('button', { name: 'Correct…' }))
    await userEvent.clear(screen.getByLabelText('Children'))
    await userEvent.type(screen.getByLabelText('Children'), '4')
    await userEvent.type(screen.getByLabelText('Reason'), 'Confirmed by phone{Enter}')
    expect(sentBody().body).toEqual({
      field: 'num_children',
      new_value: '4',
      reason: 'Confirmed by phone',
    })
  })
})

describe('HeadcountForm on the wire', () => {
  it('PUTs the headcount with its reason_code', async () => {
    const family = householdRequest(
      gridRow({ request_id: 'reqfamily000010', person_cm_id: 0, camper_name: '' })
    )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HeadcountForm
          request={family}
          page={householdPage({ override_reasons: ['headcount', 'discount'] })}
          onDone={() => undefined}
        />
      </QueryClientProvider>
    )
    await userEvent.selectOptions(screen.getByLabelText('Reason code'), 'discount')
    await userEvent.type(screen.getByLabelText('Reason'), 'Billing shows it{Enter}')
    const sent = sentBody()
    expect(sent.method).toBe('PUT')
    expect(sent.url).toContain('/requests/reqfamily000010/headcount')
    expect(sent.body).toEqual({
      non_infant: 2,
      infant: 1,
      source: 'override',
      reason: 'Billing shows it',
      reason_code: 'discount',
    })
  })
})

describe('ShareForm on the wire', () => {
  it('PUTs the percentage and never an amount (owner ruling: shares are percent only)', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ShareForm request={SPLIT_PAGE.requests[0]!} page={SPLIT_PAGE} onDone={() => undefined} />
      </QueryClientProvider>
    )
    await userEvent.selectOptions(screen.getByLabelText('Household'), '1000003')
    await userEvent.type(screen.getByLabelText('Share'), '40')
    await userEvent.type(screen.getByLabelText('Reason'), 'Parents agreed 60/40{Enter}')
    const sent = sentBody()
    expect(sent.method).toBe('PUT')
    expect(sent.url).toContain('1000003')
    // toEqual would let an `amount: undefined` through as absent; the key list is the pin.
    expect(Object.keys(sent.body as object).sort()).toEqual(['reason', 'share_pct'])
    expect(sent.body).toEqual({ share_pct: '40', reason: 'Parents agreed 60/40' })
  })
})
