/** Grants › Expected (§8.2; D56; P-25): never a grant, in the generic words or the grantor the server names. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidGrants } from '../../../types/api-types'
import { ExpectedTab } from './ExpectedTab'
import { GRANTS } from './grantsFixtures'

vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => p === 'financial_aid.view' }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const READ: ApiAidGrants = {
  ...GRANTS,
  expected: [
    ...GRANTS.expected,
    {
      household_cm_id: 1000004,
      family_name: 'Sam',
      kind: 'synagogue',
      person_cm_ids: [2000004],
      camper_names: ['Riley Sam'],
      display_name: 'Grantor B',
    },
  ],
}

let fetchSpy: MockInstance<typeof fetch>
beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(READ), { status: 200 })))
})
afterEach(() => fetchSpy.mockRestore())

function renderTab() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ExpectedTab view={{ year: 2027, asOf: { kind: 'live' } }} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Grants › Expected (D56)', () => {
  it('lists each family, its campers and what the form says, and says it never counts', async () => {
    renderTab()
    expect(
      await screen.findByRole('cell', { name: 'Expected: synagogue grant' })
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Expected: Grantor B' })).toBeInTheDocument()
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.getByText('Never a grant.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Chen' })).toHaveAttribute(
      'href',
      '/aid/households/1000003?year=2027'
    )
  })

  it('filters by what the form says', async () => {
    renderTab()
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Said' }),
      'Expected: Grantor B'
    )
    expect(screen.queryByText('Olivia Chen')).toBeNull()
    expect(screen.getByText('Riley Sam')).toBeInTheDocument()
  })
})
