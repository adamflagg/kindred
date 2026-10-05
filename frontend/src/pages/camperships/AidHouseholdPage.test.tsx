import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  householdPage,
  householdRequest,
} from '../../components/camperships/household/householdFixtures'
import { FLAGGED_PAGE } from '../../components/camperships/household/sectionsFixtures'
import { gridRow, GRID_ROWS, ROW_OLIVIA } from '../../components/camperships/requests/gridFixtures'
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
// What the grid read is doing: loaded (the default), still loading, or failed.
let gridState: { rows: typeof GRID_ROWS | null; isError: boolean }
vi.mock('../../hooks/camperships/useAidGrid', () => ({
  useAidGrid: (options: { enabled?: boolean; live?: boolean }) => {
    gridAsked.push(options)
    return {
      data:
        options.enabled === false || gridState.rows === null
          ? undefined
          : { year: 2027, rules_version: 1, rows: gridState.rows },
      isError: gridState.isError,
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
// The permissions held: view only by default, so the cards stay plain.
let granted: string[] = ['financial_aid.view']
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
const keyAskMutate = vi.fn()
const idle = { isPending: false, error: null, mutate: vi.fn(), mutateAsync: vi.fn() }
vi.mock('../../hooks/camperships/useAidWrites', () => ({
  useAidCancellation: () => idle,
  useAidManualHold: () => idle,
  useAidHoldRelease: () => idle,
  useAidTickPosted: () => idle,
  useAidTickAccepted: () => idle,
  useAidUndoPosted: () => idle,
  useAidRound3Decision: () => idle,
  useAidKeyAsk: () => ({ ...idle, mutate: keyAskMutate }),
  useAidRound3Amount: () => idle,
  useAidCorrection: () => idle,
  useAidHouseholdShare: () => idle,
  useAidSessionResolve: () => idle,
  useAidDuplicate: () => idle,
  useAidHeadcount: () => idle,
}))
vi.mock('../../hooks/camperships/useAidApplication', () => ({
  useAidApplication: () => ({ data: undefined, isLoading: false, error: null }),
}))
vi.mock('../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => ({ preview: { status: 'idle' }, onAmountChange: () => undefined }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
// The approved rules name the programs (D31): the postings read them, as the grid does.
vi.mock('../../hooks/camperships/useAidRules', () => ({
  useAidApprovedRules: () => ({
    data: { sections: [{ section: 'programs', content: { summer: { label: 'Summer Camp' } } }] },
  }),
}))

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
  granted = ['financial_aid.view']
  result = { data: householdPage(), isLoading: false, error: null }
  asked.length = 0
  prefetched.length = 0
  gridAsked.length = 0
  gridState = { rows: GRID_ROWS, isError: false }
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

  it('keeps the cards plain, and the holds without actions, for view only', () => {
    result = {
      data: householdPage({
        requests: [
          householdRequest(
            gridRow({ holds: [{ code: 'manual_hold', severity: 'hold', message: 'm' }] })
          ),
        ],
      }),
      isLoading: false,
      error: null,
    }
    renderAt('/aid/households/1000001')
    expect(screen.queryByRole('button', { name: 'Cancel Request…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lift…' })).toBeNull()
  })

  it('gives casework the working cards and the hold actions (§6.3)', () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    result = {
      data: householdPage({
        requests: [
          householdRequest(
            gridRow({ holds: [{ code: 'manual_hold', severity: 'hold', message: 'm' }] })
          ),
        ],
      }),
      isLoading: false,
      error: null,
    }
    renderAt('/aid/households/1000001')
    expect(screen.getByRole('button', { name: 'Cancel Request…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lift…' })).toBeInTheDocument()
  })

  it('puts Correct… on the income answers for casework only, never on the income override (§9.3)', async () => {
    renderAt('/aid/households/1000001')
    await userEvent.click(screen.getByRole('button', { name: /^Income/ }))
    await userEvent.click(screen.getByRole('button', { name: /more answers? match/ }))
    expect(screen.queryByRole('button', { name: 'Correct…' })).toBeNull()
    cleanup()
    granted = ['financial_aid.view', 'financial_aid.casework']
    renderAt('/aid/households/1000001')
    // The exceptions first (income (e)): the corrected answer alone, then every answer.
    await userEvent.click(screen.getByRole('button', { name: /^Income/ }))
    expect(screen.getAllByRole('button', { name: 'Correct…' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /more answers? match/ }))
    const answers = householdPage().incomes.flatMap((i) => i.answers)
    const correctable = answers.filter((a) => a.field !== 'income_override')
    expect(screen.getAllByRole('button', { name: 'Correct…' })).toHaveLength(correctable.length)
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

  it('shows the income, the grants and postings, and the history below the cards, as tabs', () => {
    renderAt('/aid/households/1000001')
    expect(screen.getByRole('button', { name: /^Income/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Grants and postings/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^History/ })).toBeInTheDocument()
    expect(screen.queryByTestId('tab-panel')).toBeNull()
  })

  it("names a posting's program as the approved rules do (D31)", async () => {
    renderAt('/aid/households/1000001')
    await userEvent.click(screen.getByRole('button', { name: /^Grants and postings/ }))
    expect(
      within(screen.getByRole('table', { name: 'Postings' })).getAllByText('Summer Camp')
    ).toHaveLength(2)
  })

  it('opens the income on its own for a flagged family', () => {
    result = { data: FLAGGED_PAGE, isLoading: false, error: null }
    renderAt('/aid/households/1000001')
    expect(within(screen.getByTestId('tab-panel')).getByText('Gross income')).toBeInTheDocument()
  })

  it('resets the tabs when the walk opens the next family', async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/aid/households/1000001']}>
        <Routes>
          <Route path="/aid/households/:householdCmId" element={<AidHouseholdPage />} />
        </Routes>
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: /^History/ }))
    expect(screen.getByTestId('tab-panel')).toBeInTheDocument()
    result = { data: householdPage({ household_cm_id: 1000005 }), isLoading: false, error: null }
    rerender(
      <MemoryRouter initialEntries={['/aid/households/1000005']}>
        <Routes>
          <Route path="/aid/households/:householdCmId" element={<AidHouseholdPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.queryByTestId('tab-panel')).toBeNull()
  })
})

describe('the queue walk (§3.5; D14)', () => {
  it('shows where the family sits in the view it came from, and its neighbours by name and reason', () => {
    renderAt('/aid/households/1000005?from=all')
    expect(screen.getByRole('link', { name: '← Back to All' })).toHaveAttribute(
      'href',
      '/aid/requests?row=reqolivia000003&year=2027'
    )
    expect(screen.getByText(/3 of 4 families/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '‹ The Garcia Family · Placeholder income' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'The Sam Family · Reverse posting ›' })
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
      '/aid/requests?program=quest&row=reqolivia000003&year=2027'
    )
    // Only the Chen family is in Quest: no neighbours to step to.
    expect(screen.queryByRole('link', { name: /The Sam Family/ })).toBeNull()
  })

  // Added after a mutation check showed no test pinned the filters on a step.
  it("carries the grid's filters on a step, and walks only the filtered rows (M5)", async () => {
    renderAt('/aid/households/1000003?from=all&pool=pool_a')
    expect(screen.getByText(/2 of 3 families/)).toBeInTheDocument()
    await userEvent.keyboard(']')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000007?from=all&pool=pool_a&year=2027'
    )
  })

  it("keeps the grid's as-of on the way back and on a step (it came on the link)", async () => {
    renderAt('/aid/households/1000005?from=all&as_of=2027-03-01')
    expect(screen.getByRole('link', { name: '← Back to All' })).toHaveAttribute(
      'href',
      '/aid/requests?row=reqolivia000003&year=2027&as_of=2027-03-01'
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
      '/aid/requests?row=reqolivia000003&year=2027'
    )
  })

  // One URL scheme (owner ruling 10-03, T4): the grid's link carries `from=<stage slug>` (or `all`)
  // and `lens=appeals`; the walk steps through what that lens and stage showed, and Back returns there.
  it('walks the Appeals lens: appeals only, and Back keeps the lens with no view', async () => {
    renderAt('/aid/households/1000005?from=all&lens=appeals')
    expect(screen.getByRole('link', { name: '← Back to Appeals' })).toHaveAttribute(
      'href',
      '/aid/requests?lens=appeals&row=reqolivia000003&year=2027'
    )
    expect(screen.getByText(/1 of 1 families/)).toBeInTheDocument()
  })

  it('walks a stage under the Appeals lens, and every link keeps both', () => {
    renderAt('/aid/households/1000001?from=needs-offer&lens=appeals')
    // Johnson's request is no appeal: not in the walk under the Appeals lens.
    expect(screen.getByText(/not in Needs an offer now/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Back to Needs an offer' })).toHaveAttribute(
      'href',
      '/aid/requests?view=needs-offer&lens=appeals&year=2027'
    )
  })

  it('steps through a stage with its slug and the lens on the link', async () => {
    renderAt('/aid/households/1000001?from=needs-offer')
    await userEvent.keyboard(']')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000005?from=needs-offer&year=2027'
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

  it("keeps the grid's sort and grouping on Back, and steps in that order (I1)", async () => {
    // Total decided, largest first: Chen, Johnson, Sam, Garcia.
    renderAt('/aid/households/1000005?from=all&sort=total:desc&group=reason')
    const back = screen.getByRole('link', { name: '← Back to All' }).getAttribute('href') ?? ''
    const params = new URL(back, 'http://x').searchParams
    expect(params.get('sort')).toBe('total:desc')
    expect(params.get('group')).toBe('reason')
    await userEvent.keyboard(']')
    const where = new URL(String(screen.getByTestId('where').textContent), 'http://x')
    expect(where.pathname).toBe('/aid/households/1000001')
    expect(where.searchParams.get('sort')).toBe('total:desc')
    expect(where.searchParams.get('group')).toBe('reason')
  })
})

describe('Back when the walk has no place for the family (I2)', () => {
  const noWalk = () => {
    expect(screen.queryByText(/ of \d+ families/)).toBeNull()
    expect(screen.queryByRole('link', { name: /[‹›]/ })).toBeNull()
  }

  it('shows Back alone while the grid read is loading, claiming nothing', () => {
    gridState = { rows: null, isError: false }
    renderAt('/aid/households/1000005?from=all')
    expect(screen.getByRole('link', { name: '← Back to All' })).toHaveAttribute(
      'href',
      '/aid/requests?year=2027'
    )
    expect(screen.queryByText(/not in All now/)).toBeNull()
    noWalk()
  })

  it('shows Back alone when the grid read failed', () => {
    gridState = { rows: null, isError: true }
    renderAt('/aid/households/1000005?from=all')
    expect(screen.getByRole('link', { name: '← Back to All' })).toBeInTheDocument()
    expect(screen.queryByText(/not in All now/)).toBeNull()
    noWalk()
  })

  it('says the family is not in the view now, once the read has landed without it', async () => {
    gridState = { rows: GRID_ROWS.filter((row) => row.household_cm_id !== 1000005), isError: false }
    renderAt('/aid/households/1000005?from=all')
    expect(screen.getByRole('link', { name: '← Back to All' })).toBeInTheDocument()
    expect(screen.getByText(/not in All now/)).toBeInTheDocument()
    noWalk()
    await userEvent.keyboard(']')
    await userEvent.keyboard('[[')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005?from=all')
  })

  it('has no "not in" words when the family is in the view', () => {
    renderAt('/aid/households/1000005?from=all')
    expect(screen.queryByText(/not in All now/)).toBeNull()
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

  it('opens the income and scrolls to it for "#income" (the grid\'s Enter the Income step)', () => {
    renderWithHash('#income')
    expect(scrolled.map((el) => el.id)).toEqual(['income'])
    expect(screen.getByTestId('tab-panel')).toBeInTheDocument()
  })

  it('does nothing with no hash, or a hash naming nothing on the page', () => {
    renderWithHash('')
    renderWithHash('#request-nosuchrequest')
    expect(scrolled).toEqual([])
  })
})

describe('the walk stands aside for an open editor (F2 4)', () => {
  const OLIVIA = '/aid/households/1000005?from=all'
  beforeEach(() => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    result = {
      data: householdPage({
        household_cm_id: 1000005,
        requests: [householdRequest(ROW_OLIVIA)],
      }),
      isLoading: false,
      error: null,
    }
    keyAskMutate.mockReset()
    keyAskMutate.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    })
  })
  const typeAppeal = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
  }

  const saved = () =>
    expect(keyAskMutate).toHaveBeenCalledWith(
      { requestId: 'reqolivia000003', body: expect.objectContaining({ round: 2, amount: 1300 }) },
      expect.anything()
    )

  it('saves first and then steps on ]', async () => {
    renderAt(OLIVIA)
    await typeAppeal()
    await userEvent.click(screen.getByRole('heading', { level: 1 }))
    await userEvent.keyboard(']')
    saved()
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000007')
  })

  it('saves first and then goes on a click of ›, ‹ or Back', async () => {
    for (const [name, where] of [
      [/The Sam Family.* ›/, '/aid/households/1000007'],
      [/‹ The Garcia Family/, '/aid/households/1000003'],
      ['← Back to All', '/aid/requests?row='],
    ] as const) {
      keyAskMutate.mockClear()
      const { unmount } = renderAt(OLIVIA)
      await typeAppeal()
      await userEvent.click(screen.getByRole('link', { name }))
      saved()
      expect(screen.getByTestId('where')).toHaveTextContent(where)
      unmount()
    }
  })

  it('steps at once with nothing typed', async () => {
    renderAt(OLIVIA)
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    await userEvent.click(screen.getByRole('heading', { level: 1 }))
    await userEvent.keyboard(']')
    expect(keyAskMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000007')
  })

  it('stays, and shows what is missing, when the edit cannot be saved', async () => {
    renderAt(OLIVIA)
    await userEvent.click(screen.getByRole('button', { name: 'Round 3 Ask…' }))
    await userEvent.keyboard('450')
    await userEvent.click(screen.getByRole('heading', { level: 1 }))
    await userEvent.keyboard(']')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005?from=all')
    expect(screen.getByText('Statement of need is required')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '← Back to All' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005?from=all')
  })
})

describe('Correct… and the open editor (one open editor per page)', () => {
  beforeEach(() => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    result = {
      data: householdPage({ household_cm_id: 1000005, requests: [householdRequest(ROW_OLIVIA)] }),
      isLoading: false,
      error: null,
    }
    keyAskMutate.mockReset()
    keyAskMutate.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    })
  })

  it("saves what is typed in the card's editor before the correction form opens", async () => {
    renderAt('/aid/households/1000005')
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
    await userEvent.click(screen.getByRole('button', { name: /^Income/ }))
    await userEvent.click(screen.getByRole('button', { name: /more answers? match/ }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Correct…' })[0]!)
    expect(keyAskMutate).toHaveBeenCalledWith(
      { requestId: 'reqolivia000003', body: expect.objectContaining({ round: 2, amount: 1300 }) },
      expect.anything()
    )
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(screen.getByLabelText('Reason')).toBeInTheDocument()
  })
})

describe('Correct… opens in the answers column (owner bug B30)', () => {
  beforeEach(() => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    result = { data: householdPage(), isLoading: false, error: null }
  })

  it('opens under its answer, across the answers table', async () => {
    renderAt('/aid/households/1000001')
    await userEvent.click(screen.getByRole('button', { name: /^Income/ }))
    const answerRow = screen.getByText('Children').closest('tr') as HTMLElement
    await userEvent.click(within(answerRow).getByRole('button', { name: 'Correct…' }))
    const form = screen.getByLabelText('Reason').closest('[data-editor-box]') as HTMLElement
    // Round 3 (owner, section 4 option E): What priced it is gone; the answers run full width.
    expect(screen.queryByTestId('priced')).toBeNull()
    expect(answerRow.closest('table')!.contains(form)).toBe(true)
    // Not in the answer's own row, whose cells size the answers column: there its width pushed the
    // column wide (it once squashed What priced it off the page). Its own row spans the table instead...
    expect(answerRow.contains(form)).toBe(false)
    expect(form.closest('td')!.colSpan).toBe(4)
    // ...inside a box that adds nothing to the column's width (width 0, at least the cell's), so
    // the form wraps to the answers' width. jsdom has no layout: this class pair is the handle.
    expect(form.closest('.w-0.min-w-full')).not.toBeNull()
  })
})
