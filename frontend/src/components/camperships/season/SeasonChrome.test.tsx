/** The Season chrome (spec §4): Approve… on the tab bar, the panel, the notice. Hooks mocked; fixtures fictional. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidRulesDraft } from '../../../types/api-types'
import { rulesDraft } from './rules/rulesFixtures'
import { ApproveButton, ApprovePanel, SeasonChromeProvider, SeasonNotice } from './SeasonChrome'
import { useSeasonChrome } from './seasonChrome'

let granted: string[] = []
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
let draft: ApiAidRulesDraft | undefined
vi.mock('../../../hooks/camperships/useAidRules', () => ({
  useAidRulesDraft: () => ({ data: draft, isLoading: false, error: null }),
}))
vi.mock('../../../hooks/camperships/useAidRulesWrites', () => ({
  useAidApproveRules: () => ({ mutate: vi.fn(), isPending: false }),
  useFreshAidRulesDraft: () => () => Promise.resolve(draft as ApiAidRulesDraft),
}))

const FINANCE = ['financial_aid.view', 'financial_aid.casework', 'financial_aid.rules']

function Notice() {
  const { setNotice } = useSeasonChrome()
  return (
    <button
      type="button"
      onClick={() => setNotice('Saved to the rules draft v5 · Approve on the tab bar')}
    >
      Say
    </button>
  )
}

function renderChrome(path = '/aid/season/rounds-budget') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SeasonChromeProvider section="budget">
        <ApproveButton />
        <ApprovePanel />
        <SeasonNotice />
        <Notice />
      </SeasonChromeProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = FINANCE
  draft = rulesDraft() // award_tables is a draft section
  // As AidSeasonPage.test.tsx does: a date is "past" only against a camp today that follows it.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('SeasonChrome (spec §4)', () => {
  it('opens the panel from Approve…, which hides while the panel is open', async () => {
    renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(screen.getByTestId('approve-form')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  // A regression guard: the panel's words (spec §4) were written with the re-skin.
  it('words the panel as the mock does, with Esc named and the checkbox named by its section alone', async () => {
    renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(await screen.findByLabelText('Approved by')).toBeInTheDocument()
    expect(screen.getByText('Esc cancels')).toBeInTheDocument()
  })

  it('shows one notice line with Dismiss, the only place results appear', async () => {
    renderChrome()
    await userEvent.click(screen.getByRole('button', { name: 'Say' }))
    expect(screen.getByTestId('rules-notice')).toHaveTextContent(
      'Saved to the rules draft v5 · Approve on the tab bar'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('rules-notice')).toBeNull()
  })

  it('offers nothing to the registrar', () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    renderChrome()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  it('offers nothing on a past date', () => {
    renderChrome('/aid/season/rounds-budget?as_of=2027-03-15')
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })

  it('offers nothing when no section waits for approval', () => {
    const d = rulesDraft()
    draft = {
      ...d,
      sections: d.sections.map((s) => ({ ...s, status: { ...s.status, state: 'approved' } })),
    }
    renderChrome()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })
})
