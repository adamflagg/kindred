import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidHouseholdPage } from '../../../types/api-types'
import { householdPage } from './householdFixtures'
import { HouseholdTabs } from './HouseholdTabs'
import { FLAGGED_PAGE, HISTORY_PAGE, PLAIN_PAGE, TWO_HOUSEHOLD_PAGE } from './sectionsFixtures'

const downloadSpy = vi.fn()
vi.mock('../../../utils/csvExport', async (importActual) => ({
  ...(await importActual<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => downloadSpy(...args),
}))

let scrolled: Element[]
const original = Element.prototype.scrollIntoView
beforeEach(() => {
  downloadSpy.mockClear()
  scrolled = []
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this)
  })
})
afterEach(() => {
  Element.prototype.scrollIntoView = original
})

function renderTabs(page: ApiAidHouseholdPage, hash = '') {
  return render(<HouseholdTabs page={page} programNames={{}} hash={hash} />)
}

const tab = (name: RegExp) => screen.getByRole('button', { name })
const INCOME = /^Income/
const GRANTS = /^Grants and postings/
const HISTORY = /^History/
const LINKED = /^Linked households/
const panel = () => screen.queryByTestId('tab-panel')

describe('HouseholdTabs: one card, one panel at a time (income (e) "Tabs + exceptions")', () => {
  it('draws Income, Grants and postings and History, all closed when nothing is flagged', () => {
    renderTabs(PLAIN_PAGE)
    expect(tab(INCOME)).toBeInTheDocument()
    expect(tab(GRANTS)).toBeInTheDocument()
    expect(tab(HISTORY)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: LINKED })).toBeNull()
    expect(panel()).toBeNull()
  })

  it('opens Income by itself when a flag is open, with the flag count on the tab', () => {
    renderTabs(FLAGGED_PAGE)
    expect(tab(INCOME)).toHaveTextContent('1 flag')
    expect(within(panel()!).getByText('Gross income')).toBeInTheDocument()
  })

  it('does not open Grants for an Expected chip: it counts it on the tab', () => {
    expect(PLAIN_PAGE.expected).toHaveLength(1)
    renderTabs(PLAIN_PAGE)
    expect(tab(GRANTS)).toHaveTextContent(/1 grant · 2 postings ·\s*1 expected/)
    expect(panel()).toBeNull()
  })

  it("words the Income tab's meta from the data when nothing is flagged", () => {
    renderTabs(PLAIN_PAGE)
    expect(tab(INCOME)).toHaveTextContent('Income no corrections · forms agree ✓')
  })

  it("words the History tab's meta: how many and the latest date", () => {
    renderTabs(HISTORY_PAGE)
    expect(tab(HISTORY)).toHaveTextContent('History 6 · latest Mar 14')
  })

  it('opens a tab on a click, switches on another, and closes on a second click', async () => {
    renderTabs(PLAIN_PAGE)
    await userEvent.click(tab(GRANTS))
    expect(within(panel()!).getByText('Grants')).toBeInTheDocument()
    expect(tab(GRANTS)).toHaveTextContent('▴')
    await userEvent.click(tab(HISTORY))
    expect(within(panel()!).getByText('oldest first')).toBeInTheDocument()
    await userEvent.click(tab(HISTORY))
    expect(panel()).toBeNull()
    expect(tab(HISTORY)).toHaveTextContent('▸')
  })

  it('shows Download Postings only while Grants is open, and Download History only while History is', async () => {
    renderTabs(HISTORY_PAGE)
    expect(screen.queryByRole('button', { name: 'Download Postings' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Download History' })).toBeNull()
    await userEvent.click(tab(GRANTS))
    await userEvent.click(screen.getByRole('button', { name: 'Download Postings' }))
    expect(downloadSpy.mock.calls[0]?.[1]).toBe('camperships-household-1000001-postings-2027.csv')
    await userEvent.click(tab(HISTORY))
    expect(screen.queryByRole('button', { name: 'Download Postings' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Download History' }))
    expect(downloadSpy.mock.calls[1]?.[1]).toBe('camperships-household-1000001-history-2027.csv')
  })

  it('offers no History download when nothing is recorded', async () => {
    renderTabs(householdPage({ history: [] }))
    expect(tab(HISTORY)).toHaveTextContent('none recorded')
    await userEvent.click(tab(HISTORY))
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download History' })).toBeNull()
  })
})

describe('the Linked households tab (N9)', () => {
  it('shows with two households and a link, with the count', () => {
    renderTabs(TWO_HOUSEHOLD_PAGE)
    expect(tab(LINKED)).toHaveTextContent('Linked households 1')
  })

  it('is absent with one household, even with a link, and with two households and no link', () => {
    const { unmount } = renderTabs({ ...PLAIN_PAGE, links: TWO_HOUSEHOLD_PAGE.links })
    expect(screen.queryByRole('button', { name: LINKED })).toBeNull()
    unmount()
    renderTabs({ ...TWO_HOUSEHOLD_PAGE, links: [] })
    expect(screen.queryByRole('button', { name: LINKED })).toBeNull()
  })
})

describe('#income: the hold banner and the grid land on the income', () => {
  it('opens Income when the page is opened at #income', () => {
    renderTabs(PLAIN_PAGE, '#income')
    expect(within(panel()!).getByText('All 14 answers match ▸')).toBeInTheDocument()
  })

  it('opens Income and scrolls to it on a click of a #income link, every time', async () => {
    render(
      <>
        <a href="#income">Enter the Income ↓</a>
        <HouseholdTabs page={PLAIN_PAGE} programNames={{}} hash="" />
      </>
    )
    await userEvent.click(screen.getByRole('link', { name: 'Enter the Income ↓' }))
    expect(panel()).not.toBeNull()
    expect(scrolled.map((el) => el.id)).toEqual(['income'])
    await userEvent.click(tab(INCOME))
    expect(panel()).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: 'Enter the Income ↓' }))
    expect(panel()).not.toBeNull()
    expect(scrolled.map((el) => el.id)).toEqual(['income', 'income'])
  })

  it('opens Income when the hash turns to #income after load', () => {
    const { rerender } = renderTabs(PLAIN_PAGE)
    expect(panel()).toBeNull()
    rerender(<HouseholdTabs page={PLAIN_PAGE} programNames={{}} hash="#income" />)
    expect(panel()).not.toBeNull()
  })
})

describe('the queue walk moves to another family', () => {
  it("resets the tabs to the new family's default", async () => {
    const { rerender } = renderTabs(PLAIN_PAGE)
    await userEvent.click(tab(HISTORY))
    expect(panel()).not.toBeNull()
    rerender(
      <HouseholdTabs page={{ ...PLAIN_PAGE, household_cm_id: 1000005 }} programNames={{}} hash="" />
    )
    expect(panel()).toBeNull()
    rerender(
      <HouseholdTabs
        page={{ ...FLAGGED_PAGE, household_cm_id: 1000007 }}
        programNames={{}}
        hash=""
      />
    )
    expect(within(panel()!).getByText('Gross income')).toBeInTheDocument()
  })

  it('keeps the open tab across a refetch of the same family, even once its flag is resolved', async () => {
    const { rerender } = renderTabs(FLAGGED_PAGE)
    expect(panel()).not.toBeNull()
    rerender(<HouseholdTabs page={PLAIN_PAGE} programNames={{}} hash="" />)
    expect(panel()).not.toBeNull()
  })
})
