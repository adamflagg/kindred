/**
 * The correction form through the REAL write hook, down to what reaches `fetch` (Task 32 review I1):
 * the way back to the form's figure is `new_value: null`. An empty string is a 422 for every field kind.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { IncomeCorrection } from './CaseworkForms'
import { householdPage } from './householdFixtures'

vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
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
