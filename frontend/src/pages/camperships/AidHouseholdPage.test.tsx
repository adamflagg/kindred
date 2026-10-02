import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { householdPage } from '../../components/camperships/household/householdFixtures'
import { GRID_ROWS } from '../../components/camperships/requests/gridFixtures'
import { AidApiError } from '../../services/camperships/aidApi'
import type { ApiAidHouseholdPage } from '../../types/api-types'
import AidHouseholdPage from './AidHouseholdPage'

interface PageResult {
  data: ApiAidHouseholdPage | undefined
  isLoading: boolean
  error: Error | null
}
let result: PageResult
const asked: number[] = []
const prefetched: Array<number | null> = []
vi.mock('../../hooks/camperships/useAidHouseholdPage', () => ({
  useAidHouseholdPage: (id: number) => {
    asked.push(id)
    return result
  },
  usePrefetchHousehold: (id: number | null) => {
    prefetched.push(id)
  },
}))
const gridAsked: Array<{ enabled?: boolean; live?: boolean }> = []
vi.mock('../../hooks/camperships/useAidGrid', () => ({
  useAidGrid: (options: { enabled?: boolean; live?: boolean }) => {
    gridAsked.push(options)
    return {
      data:
        options.enabled === false ? undefined : { year: 2027, rules_version: 1, rows: GRID_ROWS },
    }
  },
}))
const NOTES: Record<string, number> = { cost: 1, decided: 2, grants: 3, family_share: 4, posted: 5 }
vi.mock('../../hooks/camperships/useAidDefinitions', () => ({
  useAidDefinitions: () => ({
    notes: [],
    numberOf: (k: string) => NOTES[k] ?? null,
    isPending: false,
    error: null,
  }),
}))
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: () => null,
}))
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => p === 'financial_aid.view' }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/aid/households/:householdCmId"
          element={
            <>
              <AidHouseholdPage />
              <Where />
            </>
          }
        />
        <Route path="/aid/requests" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  result = { data: householdPage(), isLoading: false, error: null }
  asked.length = 0
  prefetched.length = 0
  gridAsked.length = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidHouseholdPage (§6.3)', () => {
  it('names the family in the band, with the totals on its right (D77)', () => {
    renderAt('/aid/households/1000001')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Johnson Family')
    expect(screen.getByText('$9,300')).toBeInTheDocument()
    expect(screen.getByText('posted · 1 short $210')).toBeInTheDocument()
    expect(asked).toContain(1000001)
  })

  it("shows each request's card", () => {
    renderAt('/aid/households/1000001')
    expect(screen.getAllByRole('table', { name: 'Decision panel' })).toHaveLength(2)
  })

  it('says a household has no aid activity this season, rather than spinning (Review Focus 3)', () => {
    result = { data: undefined, isLoading: false, error: new AidApiError('no aid activity', 404) }
    renderAt('/aid/households/1000009')
    expect(screen.getByText('No aid activity for household 1000009 in 2027.')).toBeInTheDocument()
    expect(screen.queryByText(/Loading/)).toBeNull()
  })

  it('reads nothing for an id that is not one, and says so', () => {
    result = { data: undefined, isLoading: false, error: null }
    renderAt('/aid/households/abc')
    expect(asked).toEqual([0])
    expect(screen.getByText('No aid activity for household abc in 2027.')).toBeInTheDocument()
  })

  it('is live only: a past date in the link gets a line saying so (Decision 36)', () => {
    renderAt('/aid/households/1000001?as_of=2027-03-01')
    expect(screen.getByText(/shows today's figures only/)).toBeInTheDocument()
    expect(screen.queryByText(/^As of Mar 1, 2027/)).toBeNull()
  })

  it('keeps showing what loaded when a background refetch fails (Decision 33)', () => {
    result = { data: householdPage(), isLoading: false, error: new Error('Network down') }
    renderAt('/aid/households/1000001')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Johnson Family')
    expect(screen.queryByText(/Network down/)).toBeNull()
  })

  it('shows the income, the grants and postings, and the history below the cards', () => {
    renderAt('/aid/households/1000001')
    expect(screen.getByRole('heading', { name: 'Household income' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Grants and postings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
  })
})

describe('the queue walk (§3.5; D14)', () => {
  it('shows where the family sits in the view it came from, and its neighbours by name and reason', () => {
    renderAt('/aid/households/1000005?from=all')
    expect(screen.getByRole('link', { name: '← Back to All' })).toHaveAttribute(
      'href',
      '/aid/requests?view=all&row=reqolivia000003&year=2027'
    )
    expect(screen.getByText(/3 of 4 families/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '‹ The Garcia Family · placeholder income' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'The Sam Family · reverse posting ›' })
    ).toBeInTheDocument()
    expect(gridAsked.at(-1)).toEqual({ enabled: true, live: true })
  })

  it('steps with ] and [, carrying the view', async () => {
    renderAt('/aid/households/1000005?from=all')
    await userEvent.keyboard(']')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000007?from=all&year=2027'
    )
    // '[[' is user-event's escape for a literal '[' (a lone '[' opens a key descriptor).
    await userEvent.keyboard('[[')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000005?from=all&year=2027'
    )
  })

  it("keeps the grid's filters on every step and on the way back (M5)", () => {
    renderAt('/aid/households/1000005?from=all&program=quest')
    expect(screen.getByRole('link', { name: '← Back to All' })).toHaveAttribute(
      'href',
      '/aid/requests?view=all&program=quest&row=reqolivia000003&year=2027'
    )
    // Only the Chen family is in Quest: no neighbours to step to.
    expect(screen.queryByRole('link', { name: /The Sam Family/ })).toBeNull()
  })

  it("keeps the grid's as-of on the way back and on a step (it came on the link)", async () => {
    renderAt('/aid/households/1000005?from=all&as_of=2027-03-01')
    expect(screen.getByRole('link', { name: '← Back to All' })).toHaveAttribute(
      'href',
      '/aid/requests?view=all&row=reqolivia000003&year=2027&as_of=2027-03-01'
    )
    await userEvent.keyboard(']')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000007?from=all&year=2027&as_of=2027-03-01'
    )
  })

  it('goes Back to the view with a plain link, highlighting the family it left', async () => {
    renderAt('/aid/households/1000005?from=all')
    await userEvent.click(screen.getByRole('link', { name: '← Back to All' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/requests?view=all&row=reqolivia000003&year=2027'
    )
  })

  it('leaves a bracket typed in a field alone', async () => {
    render(
      <MemoryRouter initialEntries={['/aid/households/1000005?from=all']}>
        <Routes>
          <Route
            path="/aid/households/:householdCmId"
            element={
              <>
                <AidHouseholdPage />
                <input aria-label="typing" />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('textbox', { name: 'typing' }))
    await userEvent.keyboard(']')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005?from=all')
  })

  it('leaves a bracket inside a form or the editor alone', async () => {
    render(
      <MemoryRouter initialEntries={['/aid/households/1000005?from=all']}>
        <Routes>
          <Route
            path="/aid/households/:householdCmId"
            element={
              <>
                <AidHouseholdPage />
                <form>
                  <button type="button">in form</button>
                </form>
                <div data-aid-editor>
                  <button type="button">in editor</button>
                </div>
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'in form' }))
    await userEvent.keyboard(']')
    await userEvent.click(screen.getByRole('button', { name: 'in editor' }))
    await userEvent.keyboard(']')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005?from=all')
  })

  it('loads the next family in the background', () => {
    renderAt('/aid/households/1000005?from=all')
    expect(prefetched).toContain(1000007)
  })

  it('stands alone when reached from search, Grants or Money: no strip, no Back, no grid read', () => {
    renderAt('/aid/households/1000005')
    expect(screen.queryByText(/families$/)).toBeNull()
    expect(screen.queryByRole('link', { name: /Back to/ })).toBeNull()
    expect(gridAsked.every((options) => options.enabled === false)).toBe(true)
  })
})

// Scan H1 (scan-974cb9f4): the grid's next-step links land at "#income" or "#request-<id>". The app
// has no scroll restoration, and a click goes through navigate(), so the page scrolls there itself
// once the section has rendered.
describe('AidHouseholdPage: a link to a place on the page (H1)', () => {
  let scrolled: Element[]
  const original = Element.prototype.scrollIntoView
  beforeEach(() => {
    scrolled = []
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this)
    })
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = original
  })

  function renderWithHash(hash: string) {
    return render(
      <MemoryRouter
        initialEntries={[{ pathname: '/aid/households/1000001', search: '?year=2027', hash }]}
      >
        <Routes>
          <Route path="/aid/households/:householdCmId" element={<AidHouseholdPage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it("scrolls to the request's card named in the hash", () => {
    const id = householdPage().requests[1]!.row.request_id
    renderWithHash(`#request-${id}`)
    expect(scrolled.map((el) => el.id)).toEqual([`request-${id}`])
  })

  it('waits for the read: nothing while loading, then the card once it renders', () => {
    const id = householdPage().requests[0]!.row.request_id
    result = { data: undefined, isLoading: true, error: null }
    const { rerender } = renderWithHash(`#request-${id}`)
    expect(scrolled).toEqual([])
    result = { data: householdPage(), isLoading: false, error: null }
    rerender(
      <MemoryRouter
        initialEntries={[
          { pathname: '/aid/households/1000001', search: '?year=2027', hash: `#request-${id}` },
        ]}
      >
        <Routes>
          <Route path="/aid/households/:householdCmId" element={<AidHouseholdPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(scrolled.map((el) => el.id)).toEqual([`request-${id}`])
  })

  it('scrolls once: a refetch does not pull the page back to the card', () => {
    const id = householdPage().requests[0]!.row.request_id
    const { rerender } = renderWithHash(`#request-${id}`)
    result = { data: householdPage(), isLoading: false, error: null }
    rerender(
      <MemoryRouter
        initialEntries={[
          { pathname: '/aid/households/1000001', search: '?year=2027', hash: `#request-${id}` },
        ]}
      >
        <Routes>
          <Route path="/aid/households/:householdCmId" element={<AidHouseholdPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(scrolled).toHaveLength(1)
  })

  it('scrolls to the income section for "#income" (the grid\'s Enter the Income step)', () => {
    renderWithHash('#income')
    expect(scrolled.map((el) => el.id)).toEqual(['income'])
  })

  it('does nothing with no hash, or a hash naming nothing on the page', () => {
    renderWithHash('')
    renderWithHash('#request-nosuchrequest')
    expect(scrolled).toEqual([])
  })
})
