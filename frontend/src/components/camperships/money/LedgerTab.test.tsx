/** Money › Ledger's posted totals (F10; money-v2's pivot; R3-2), through the real hooks. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidBudget, ApiAidSummary } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { BUDGET } from '../season/budgetFixtures'
import { TO_PLACE } from './toPlaceFixtures'
import { LedgerTab } from './LedgerTab'
import {
  LEDGER_NOTE_ENTRIES,
  RULES_2027,
  SUMMARY,
  SUMMARY_PAST,
  SUMMARY_UNCLASSIFIED,
} from './ledgerFixtures'
import { TIE_OUT_NOTE, UNCLASSIFIED_NOTE } from './ledgerModel'

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
vi.mock('../../../hooks/camperships/useAidDefinitions', async () => {
  const { ledgerDefinitions } = await import('./ledgerFixtures')
  return { useAidDefinitions: () => ledgerDefinitions() }
})
vi.mock('../shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: ({ surface, extra = [] }: { surface: string; extra?: readonly string[] }) => (
    <div>
      <p>{`Notes for ${surface}`}</p>
      {extra.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </div>
  ),
}))
// The family rows have their own tests (LedgerFamilies.test.tsx, LedgerLines.test.tsx).
vi.mock('./LedgerFamilies', () => ({
  LedgerFamilies: ({
    unclassified,
    programLabels,
  }: {
    unclassified?: number | null
    programLabels?: Record<string, string>
  }) => (
    <div>
      Family rows<span data-testid="unclassified-prop">{String(unclassified)}</span>
      <span data-testid="labels-prop">{JSON.stringify(programLabels)}</span>
    </div>
  ),
}))

let summary: ApiAidSummary = SUMMARY
const budgetPosting = (posted: number): ApiAidBudget => ({
  ...BUDGET,
  total: { ...BUDGET.total, total: { ...BUDGET.total.total, posted } },
})
let budget: ApiAidBudget = budgetPosting(SUMMARY.counts_toward_budget)
let budgetStatus = 200
let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  summary = SUMMARY
  budget = budgetPosting(SUMMARY.counts_toward_budget)
  budgetStatus = 200
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = String(url)
    if (u.includes('/budget')) {
      return Promise.resolve(new Response(JSON.stringify(budget), { status: budgetStatus }))
    }
    if (u.includes('/to-place')) {
      return Promise.resolve(new Response(JSON.stringify(TO_PLACE), { status: 200 }))
    }
    const body = u.includes('/rules/') ? RULES_2027 : summary
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

function renderTab(path: string, view: AidView) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LedgerTab view={view} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const rowOf = (words: string) => {
  const row = screen.getAllByText(words)[0]?.closest('tr')
  if (row === null || row === undefined) throw new Error(`no row for ${words}`)
  return row
}

describe('Money › Ledger (§8.1; F10 as money-v2 draws it)', () => {
  // Owner ruling (final audit): the two Program vocabularies are both labelled, with one note.
  it('says Program is CampMinder’s and how it differs from Requests', async () => {
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await screen.findAllByText('Summer Sessions')
    expect(screen.getByTestId('program-words-note')).toHaveTextContent(
      'Requests uses the program the rules price under'
    )
  })

  it("shows the family rows, then camp aid, outside grants and the total per program, in the rules' words and order", async () => {
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    expect(screen.getByText('Family rows')).toBeInTheDocument()
    await screen.findAllByText('Summer Sessions')
    for (const header of ['Program (in CM)', 'Camp aid (net)', 'Outside grants', 'Total']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    expect(screen.queryByRole('columnheader', { name: 'Unclassified' })).toBeNull()
    const summer = rowOf('Summer Sessions')
    for (const figure of ['$541,200', '$98,400', '$639,600']) {
      expect(within(summer).getByText(figure)).toBeInTheDocument()
    }
    // The server's footer, never a sum of the rows on screen.
    const foot = rowOf('All programs')
    for (const figure of ['$599,500', '$135,000', '$734,500']) {
      expect(within(foot).getByText(figure)).toBeInTheDocument()
    }
    expect(
      screen.getByText(
        'Counts toward the budget: $612,540 · placed on a camper or request: 91% · at household level: 7% · not placed: 2% (each share of camp aid). Undated postings: 0.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/A split placement still counts/)).toBeNull()
    expect(screen.getByText('Notes for money-ledger')).toBeInTheDocument()
    // §12 (owner ★5): the tie-out is note 3 while the season has no unclassified money.
    expect(screen.getByText(TIE_OUT_NOTE)).toBeInTheDocument()
    expect(screen.queryByText(UNCLASSIFIED_NOTE)).toBeNull()
    // Final audit E2: a 4-6 row program table holds no names or CM ids, so it draws no search box
    // (it keeps Download CSV); the footer is the season's, from the server.
    expect(screen.queryByRole('searchbox', { name: 'Search' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
    expect(within(rowOf('All programs')).getByText('$599,500')).toBeInTheDocument()
  })

  it('shows an Unclassified column only for a season with an unclassified line', async () => {
    summary = SUMMARY_UNCLASSIFIED
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    expect(await screen.findByRole('columnheader', { name: 'Unclassified' })).toBeInTheDocument()
    expect(within(rowOf('All programs')).getByText('$734,900')).toBeInTheDocument()
  })

  it("shows each pivot row's program_label, and the bucket words where the server sends none", async () => {
    const BASE_ROW = SUMMARY.by_program?.[0]
    if (BASE_ROW === undefined) throw new Error('fixture')
    summary = {
      ...SUMMARY,
      by_program: [
        ...(SUMMARY.by_program ?? []),
        { ...BASE_ROW, program: 'quest', program_label: 'Session 3' },
        { ...BASE_ROW, program: 'teen' },
      ],
    }
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await screen.findByText('Session 3')
    expect(screen.getByText('Household level')).toBeInTheDocument()
    expect(screen.getByText('Not placed')).toBeInTheDocument()
    expect(screen.getByText('Other program')).toBeInTheDocument()
    expect(screen.queryByText(/^Teen$|^Quest$/)).toBeNull()
  })

  it("hands the family rows the summary's labels by program", async () => {
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await waitFor(() => expect(screen.getByTestId('labels-prop')).toHaveTextContent('summer'))
    expect(JSON.parse(screen.getByTestId('labels-prop').textContent)).toEqual({
      summer: 'Summer Sessions',
      family_camp: 'Family Camp Weekends',
    })
  })

  it("hands the family rows the summary's unclassified figure, never a sum", async () => {
    summary = SUMMARY_UNCLASSIFIED
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await screen.findByRole('columnheader', { name: 'Unclassified' })
    expect(screen.getByTestId('unclassified-prop')).toHaveTextContent('400')
  })

  it('on a past day: says the day, the split line and the axis note; folds', async () => {
    summary = SUMMARY_PAST
    renderTab('/aid/money/ledger?as_of=2027-05-01&as_of_axis=recorded', {
      year: 2027,
      asOf: { kind: 'past', date: '2027-05-01', axis: 'recorded' },
    })
    expect(screen.getByText('as of May 1, 2027 · all families')).toBeInTheDocument()
    expect(await screen.findByText(/^A split placement still counts/)).toBeInTheDocument()
    expect(screen.getByText(/Undated postings: 2\.$/)).toBeInTheDocument()
    expect(screen.getByText(/they have no "as recorded" view/)).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /Posted in CampMinder by program and source/ })
    )
    expect(screen.queryByText('$541,200')).toBeNull()
  })

  it('adds the Unclassified note, then the tie-out, after the registry’s two while the season has unclassified money', async () => {
    summary = SUMMARY_UNCLASSIFIED
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await screen.findByRole('columnheader', { name: /^Unclassified/ })
    const notes = screen.getByText('Notes for money-ledger').parentElement as HTMLElement
    const texts = Array.from(notes.querySelectorAll('p')).map((p) => p.textContent)
    expect(texts).toEqual(['Notes for money-ledger', UNCLASSIFIED_NOTE, TIE_OUT_NOTE])
  })

  it('numbers the header marks as the notes: 1, 2, and 3 on Unclassified, each titled with its note', async () => {
    summary = SUMMARY_UNCLASSIFIED
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    const unclassified = await screen.findByRole('columnheader', { name: /^Unclassified/ })
    expect(within(unclassified).getByText('3')).toHaveAttribute('title', UNCLASSIFIED_NOTE)
    const camp = screen.getByRole('columnheader', { name: /^Camp aid \(net\)/ })
    expect(within(camp).getByText('1')).toHaveAttribute('title', LEDGER_NOTE_ENTRIES[0]?.text)
    const outside = screen.getByRole('columnheader', { name: /^Outside grants/ })
    expect(within(outside).getByText('2')).toHaveAttribute('title', LEDGER_NOTE_ENTRIES[1]?.text)
  })

  it('marks the tie-out box with its note number: 4 with unclassified money, 3 without', async () => {
    summary = SUMMARY_UNCLASSIFIED
    budget = budgetPosting(SUMMARY_UNCLASSIFIED.counts_toward_budget)
    const { unmount } = renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    expect(within(await screen.findByTestId('tie-out')).getByText('4')).toHaveAttribute(
      'title',
      TIE_OUT_NOTE
    )
    unmount()
    summary = SUMMARY
    budget = budgetPosting(SUMMARY.counts_toward_budget)
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    expect(within(await screen.findByTestId('tie-out')).getByText('3')).toBeInTheDocument()
  })

  it('draws the program section’s heading on ONE row: the fold caret, its title, "today · all families", and its Download CSV', async () => {
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await screen.findAllByText('Summer Sessions')
    const bars = document.querySelectorAll('[data-aid-toolbar]')
    expect(bars).toHaveLength(1)
    const bar = bars[0] as HTMLElement
    expect(
      within(bar).getByRole('button', { name: /Posted in CampMinder by program and source/ })
    ).toBeInTheDocument()
    expect(bar).toHaveTextContent('today · all families')
    expect(within(bar).getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
  })

  it('folds to its heading row alone: no table and no Download CSV, the caret opens it again', async () => {
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await screen.findAllByText('Summer Sessions')
    const caret = screen.getByRole('button', { name: /Posted in CampMinder by program and source/ })
    await userEvent.click(caret)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull()
    expect(screen.getByText('today · all families')).toBeInTheDocument()
    const folded = screen.getByRole('button', {
      name: /Posted in CampMinder by program and source/,
    })
    expect(folded).toHaveAttribute('title', 'Open the totals by program and source')
    await userEvent.click(folded)
    expect(await screen.findAllByText('Summer Sessions')).not.toHaveLength(0)
  })

  it('mutes the Household level and Not placed rows, titled, and keeps the shares sentence under the table', async () => {
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await screen.findAllByText('Summer Sessions')
    const household = screen.getByText('Household level')
    expect(household).toHaveClass('text-muted-foreground')
    expect(household.closest('td')).toHaveAttribute(
      'title',
      'Household level: money on a household, not on a request'
    )
    expect(screen.getByText('Not placed').closest('td')).toHaveAttribute(
      'title',
      'Not placed: money with no request behind it'
    )
    expect(screen.getByText(/^Counts toward the budget:/)).toBeInTheDocument()
  })

  describe('the tie-out line', () => {
    const live: AidView = { year: 2027, asOf: { kind: 'live' } }

    it('shows a check and a link to Rounds & budget when the figures match', async () => {
      renderTab('/aid/money/ledger', live)
      const line = await screen.findByTestId('tie-out')
      expect(line).toHaveTextContent(
        'Camp aid posted $612,540 · matches Season › Rounds & budget Posted $612,540 ✓'
      )
      const link = within(line).getByRole('link', { name: /Rounds & budget/ })
      expect(link.getAttribute('href')).toMatch(/^\/aid\/season\/rounds-budget/)
      // It sits after the family rows and before the folding table.
      const html = document.body.innerHTML
      expect(html.indexOf('Family rows')).toBeLessThan(html.indexOf('data-testid="tie-out"'))
      expect(html.indexOf('data-testid="tie-out"')).toBeLessThan(
        html.indexOf('Posted in CampMinder by program and source')
      )
    })

    // §9, Q6: forest when it matches (emerald is retired), amber with ⚠ when it does not.
    it('is a forest box on a match, with no emerald left, and an amber box when the figures differ', async () => {
      const { unmount } = renderTab('/aid/money/ledger', live)
      const match = await screen.findByTestId('tie-out')
      expect(match.className).toContain('forest')
      expect(match.className).not.toContain('emerald')
      unmount()
      budget = budgetPosting(600000)
      renderTab('/aid/money/ledger', live)
      const apart = await screen.findByTestId('tie-out')
      await within(apart).findByRole('link', { name: /see To place/ })
      expect(apart.className).toContain('amber')
      expect(apart.className).not.toContain('emerald')
    })

    // Mock tieOut(): the figures are bold; a gap is an emphasised "$N apart" in the warn ink.
    it('bolds the figures, and the match line keeps them bold inside its link', async () => {
      renderTab('/aid/money/ledger', live)
      const line = await screen.findByTestId('tie-out')
      const bold = [...line.querySelectorAll('b')].map((b) => b.textContent)
      expect(bold).toEqual(['$612,540', '$612,540'])
      expect(
        within(line)
          .getByRole('link', { name: /Rounds & budget/ })
          .querySelector('b')
      ).not.toBeNull()
    })

    it('reads the gap as an emphasised "apart" in the warn ink', async () => {
      budget = budgetPosting(600000)
      renderTab('/aid/money/ledger', live)
      const line = await screen.findByTestId('tie-out')
      await within(line).findByRole('link', { name: /see To place/ })
      expect([...line.querySelectorAll('b')].map((b) => b.textContent)).toEqual([
        '$612,540',
        '$600,000',
      ])
      const gap = line.querySelector('[data-gap]')
      expect(gap).toHaveTextContent('$12,540 apart')
      expect(gap?.className).toContain('font-bold')
      expect(gap?.className).toContain('amber-700')
    })

    // formatMoney keeps cents where a figure has them ($2,399.72): the whole figure is bold, and a
    // cents gap is still the emphasised "apart".
    it('bolds a figure with cents whole, and a cents gap is still the emphasised "apart"', async () => {
      budget = budgetPosting(SUMMARY.counts_toward_budget + 0.28)
      renderTab('/aid/money/ledger', live)
      const line = await screen.findByTestId('tie-out')
      await within(line).findByRole('link', { name: /see To place/ })
      expect([...line.querySelectorAll('b')].map((b) => b.textContent)).toEqual([
        '$612,540',
        '$612,540.28',
      ])
      expect(line.querySelector('[data-gap]')).toHaveTextContent('$0.28 apart')
    })

    it('is one line: it never wraps', async () => {
      renderTab('/aid/money/ledger', live)
      expect((await screen.findByTestId('tie-out')).className).toContain('whitespace-nowrap')
    })

    it('shows the gap and To place with its open count when the figures differ', async () => {
      budget = budgetPosting(600000)
      renderTab('/aid/money/ledger', live)
      const line = await screen.findByTestId('tie-out')
      await waitFor(() =>
        expect(line).toHaveTextContent(
          `Camp aid posted $612,540 · Season › Rounds & budget Posted $600,000 · $12,540 apart → see To place (${String(TO_PLACE.open_count)} lines)`
        )
      )
      expect(line).not.toHaveTextContent('✓')
      expect(line).toHaveTextContent(/^⚠ Camp aid posted/)
      const link = within(line).getByRole('link', { name: /see To place/ })
      expect(link.getAttribute('href')).toMatch(/^\/aid\/money\/to-place/)
    })

    it('also points at Requests › Not reconciled when To place cannot explain the whole gap', async () => {
      // The gap is $12,540 and To place holds $6,920: the rest sits in Requests › Not reconciled.
      budget = budgetPosting(600000)
      renderTab('/aid/money/ledger', live)
      const line = await screen.findByTestId('tie-out')
      const link = await within(line).findByRole('link', {
        name: 'see Requests › Not reconciled',
      })
      expect(link.getAttribute('href')).toMatch(/^\/aid\/requests\?.*view=not-reconciled/)
      expect(line).toHaveTextContent(
        /see To place \(\d+ lines\) · see Requests › Not reconciled\d$/
      )
    })

    it('does not point at Not reconciled when To place holds the whole gap', async () => {
      budget = budgetPosting(612540 - TO_PLACE.open_total)
      renderTab('/aid/money/ledger', live)
      const line = await screen.findByTestId('tie-out')
      await within(line).findByRole('link', { name: /see To place/ })
      expect(within(line).queryByRole('link', { name: /Not reconciled/ })).toBeNull()
    })

    it('on a past date counts no To place lines and points at no queue it cannot size', async () => {
      budget = budgetPosting(600000)
      renderTab('/aid/money/ledger?as_of=2027-05-01', {
        year: 2027,
        asOf: { kind: 'past', date: '2027-05-01', axis: 'campminder' },
      })
      const line = await screen.findByTestId('tie-out')
      await within(line).findByRole('link', { name: /see To place/ })
      expect(line).not.toHaveTextContent(/\(\d+ lines?\)/)
      expect(within(line).queryByRole('link', { name: /Not reconciled/ })).toBeNull()
    })

    it('shows nothing while the budget is loading, and nothing when it fails', async () => {
      budgetStatus = 500
      renderTab('/aid/money/ledger', live)
      await screen.findAllByText('Summer Sessions')
      await waitFor(() =>
        expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/budget'))).toBe(true)
      )
      expect(screen.queryByTestId('tie-out')).toBeNull()
    })

    it('shows no tie-out on the as-recorded axis: the summary only goes by posting date', async () => {
      summary = SUMMARY_PAST
      renderTab('/aid/money/ledger?as_of=2027-05-01&as_of_axis=recorded', {
        year: 2027,
        asOf: { kind: 'past', date: '2027-05-01', axis: 'recorded' },
      })
      await screen.findByText(/they have no "as recorded" view/)
      await waitFor(() =>
        expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/budget'))).toBe(true)
      )
      expect(screen.queryByTestId('tie-out')).toBeNull()
    })

    it('reads the budget with the signed-in token', async () => {
      renderTab('/aid/money/ledger', live)
      await screen.findByTestId('tie-out')
      const call = fetchSpy.mock.calls.find(([u]) => String(u).includes('/budget'))
      const headers = new Headers(call?.[1]?.headers)
      expect(headers.get('Authorization')).toBe('Bearer test-jwt')
    })
  })
})
