/**
 * Scenarios' compare and trail on screen (spec §7.4; D38, D138; RPT-17). The reads are mocked with
 * scenarioFixtures; the URL holds which panel, which options, the request set and last season.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Permission } from '../../../../constants/permissions'
import type { LiveResults } from '../../../../hooks/camperships/useAidScenarioDraft'
import { AidApiError, type AidRequestSet } from '../../../../services/camperships/aidApi'
import type { ApiAidScenarioCompare, ApiAidScenarioTrailPage } from '../../../../types/api-types'
import { NO_PENDING } from './scenarioModel'
import { ROW_HIGHLIGHT } from '../../kit/kitStyles'
import { DRAFT_CHIP, DRAFT_COLUMN, START_CHIP, UP_INK, VARIANT_CHIP } from './scenarioStyles'
import { OPTIONS, TRAIL, compareOut, results, workspace } from './scenarioFixtures'
import { ScenariosTab } from './ScenariosTab'

let granted: string[] = []
let ws = workspace()
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../../../hooks/camperships/useAidScenarios', () => ({
  useAidScenarios: () => ({ data: ws, isLoading: false, error: null }),
  useAidScenarioSensitivity: () => ({
    data: { results: results(735000), levers: [] },
  }),
}))
const asked: Array<{
  codes: readonly string[]
  set: AidRequestSet
  last: boolean
  enabled: boolean | undefined
}> = []
const askedTrail: Array<{ page: number; enabled: boolean | undefined }> = []
let trail: ApiAidScenarioTrailPage = TRAIL
let trailStale = false
interface CompareState {
  data: ApiAidScenarioCompare | undefined
  isLoading: boolean
  isPlaceholderData: boolean
  error: Error | null
}
let compareState: CompareState
const settled = (): CompareState => ({
  data: compareOut(),
  isLoading: false,
  isPlaceholderData: false,
  error: null,
})
vi.mock('../../../../hooks/camperships/useAidScenarioCompare', () => ({
  useAidScenarioCompare: (
    codes: readonly string[],
    set: AidRequestSet,
    last: boolean,
    options: { enabled?: boolean } = {}
  ) => {
    asked.push({ codes, set, last, enabled: options.enabled })
    return compareState
  },
  useAidScenarioTrail: (page: number, options: { enabled?: boolean } = {}) => {
    askedTrail.push({ page, enabled: options.enabled })
    return { data: trail, isLoading: false, isPlaceholderData: trailStale, error: null }
  },
}))
const load = vi.fn<(from: { option: string } | { trail_row: string }) => Promise<boolean>>(() =>
  Promise.resolve(true)
)
vi.mock('../../../../hooks/camperships/useAidScenarioDraft', () => ({
  useAidScenarioDraft: () => ({
    pending: NO_PENDING,
    live: { status: 'idle' } as LiveResults,
    busy: null,
    error: null,
    nothingToFreeze: false,
    move: vi.fn(),
    release: vi.fn(() => Promise.resolve(true)),
    load,
    keep: vi.fn(() => Promise.resolve(true)),
    freeze: vi.fn(() => Promise.resolve(true)),
    start: vi.fn(() => Promise.resolve(true)),
  }),
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

function Where() {
  const { search } = useLocation()
  return (
    <>
      <div data-testid="where">{search}</div>
      <div data-testid="nav">{useNavigationType()}</div>
    </>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ScenariosTab />
      <Where />
    </MemoryRouter>
  )
}

const params = () => new URLSearchParams(screen.getByTestId('where').textContent)

beforeEach(() => {
  asked.length = 0
  askedTrail.length = 0
  trail = TRAIL
  trailStale = false
  compareState = settled()
  ws = workspace()
  granted = [Permission.FINANCIAL_AID_RULES]
  load.mockClear()
})

describe('the compare (D38)', () => {
  it('puts the draft first, ticked options beside it, and a changed setting in amber', () => {
    renderAt('/aid/season/scenarios?compare=A1')
    expect(asked.at(-1)).toMatchObject({ codes: ['A1'], set: { kind: 'all' }, last: false })
    const compare = screen.getByTestId('scenario-compare')
    expect(
      within(compare)
        .getAllByRole('columnheader')
        .map((th) => th.querySelector('span')?.textContent ?? '')
    ).toEqual(['', 'Draft', 'A1'])
    const minimum = compare.querySelector('[data-compare-row="minimum"]') as HTMLElement
    expect(within(minimum).getByText('$150')).toHaveClass('text-amber-700')
  })

  it('heads each column with its code chip and its label under it, and tints the draft column', () => {
    const out = compareOut()
    const [draftColumn, a1] = out.columns
    if (!draftColumn || !a1) throw new Error('the fixture has two columns')
    compareState = {
      ...settled(),
      data: {
        ...out,
        columns: [draftColumn, a1, { ...a1, code: 'B', label: 'bands $5,000 wider' }],
      },
    }
    renderAt('/aid/season/scenarios?compare=A1,B')
    const heads = within(screen.getByTestId('scenario-compare')).getAllByRole('columnheader')
    const chip = (th: HTMLElement) => th.querySelector('span')?.className ?? ''
    expect(chip(heads[1] as HTMLElement)).toContain(DRAFT_CHIP)
    expect(chip(heads[2] as HTMLElement)).toContain(VARIANT_CHIP)
    expect(chip(heads[3] as HTMLElement)).toContain(START_CHIP)
    expect(heads[2]).toHaveTextContent('Round 1 % −2 pts')
    // The label sits under its chip, at the column's right edge (the th is right-aligned).
    expect(within(heads[2] as HTMLElement).getByText('Round 1 % −2 pts')).toHaveClass('ml-auto')
    const minimum = document.querySelector('[data-compare-row="minimum"]') as HTMLElement
    const [, draft, other] = within(minimum).getAllByRole('cell')
    expect(draft?.className).toContain(DRAFT_COLUMN)
    expect(other?.className).not.toContain(DRAFT_COLUMN)
  })

  it('draws up in the positive ink and down in the negative ink', () => {
    renderAt('/aid/season/scenarios?compare=A1')
    const row = document.querySelector('[data-compare-row="updown"]') as HTMLElement
    const [, draft] = within(row).getAllByRole('cell')
    expect(within(draft as HTMLElement).getByText('▲12')).toHaveClass(UP_INK)
    expect(within(draft as HTMLElement).getByText('▼3')).toHaveClass('text-red-700')
  })

  it('ticks a kept option into the compare, in the URL, replacing the history entry', async () => {
    renderAt('/aid/season/scenarios')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Compare B' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?compare=B')
    expect(screen.getByTestId('nav')).toHaveTextContent('REPLACE')
  })

  it('refuses a fifth tick with a note, and keeps the four', async () => {
    const [a, a1, b] = OPTIONS
    if (!a || !a1 || !b) throw new Error('the fixture has three options')
    ws = workspace({
      options: [...OPTIONS, { ...b, code: 'B1', starting_point: 'B' }, { ...b, code: 'C' }],
    })
    renderAt('/aid/season/scenarios?compare=A,A1,B,B1')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Compare C' }))
    expect(params().get('compare')).toBe('A,A1,B,B1')
    expect(
      screen.getByText('Four are already checked: uncheck one to compare C.')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Compare B1' }))
    expect(params().get('compare')).toBe('A,A1,B')
    expect(screen.queryByText(/Four are already checked/)).toBeNull()
  })

  it('says how to compare, in the kept card and under the compare, in staff words', () => {
    renderAt('/aid/season/scenarios')
    expect(screen.getByText(/Check up to four to compare beside your draft/)).toBeInTheDocument()
    expect(screen.queryByText(/\btick/i)).toBeNull()
    cleanup()
    renderAt('/aid/season/scenarios?compare=A1')
    expect(
      screen.getByText(
        'Your draft is always the first column. Check kept options on the left to compare them.'
      )
    ).toBeInTheDocument()
  })

  it('counts only requests by the Round 1 deadline when asked, and says so on every figure (D138)', async () => {
    renderAt('/aid/season/scenarios?compare=A1')
    await userEvent.click(screen.getByRole('button', { name: 'By the Round 1 deadline' }))
    expect(screen.getByTestId('where')).toHaveTextContent('through=deadline')
    expect(asked.at(-1)?.set).toEqual({ kind: 'deadline' })
    expect(screen.getByTestId('nav')).toHaveTextContent('REPLACE')
  })

  it("shows last season as posted beside them, and the committee's by-tier rows (RPT-17, RPT-32)", () => {
    renderAt('/aid/season/scenarios?compare=A1&last=1&tiers=1')
    expect(
      screen.getByRole('columnheader', { name: '2026, posted (as of Jan 3, 2027)' })
    ).toBeInTheDocument()
    expect(screen.getByText('Round 1 by tier, against what was asked')).toBeInTheDocument()
    // The fixture's last season holds $649,247: tier 2 is $298,047, 48.8% of what was asked.
    const tier2 = document.querySelector('[data-compare-row="r1:2"]') as HTMLElement
    expect(within(tier2).getAllByRole('cell').at(-1)).toHaveTextContent('$298,047 · 48.8% of ask')
  })

  it('draws what the tier rows leave out apart: muted, never as one more tier', () => {
    renderAt('/aid/season/scenarios?compare=A1&tiers=1')
    for (const key of ['r1:held', 'r1:none']) {
      const row = document.querySelector(`[data-compare-row="${key}"]`) as HTMLElement
      expect(row).toHaveClass('text-muted-foreground')
    }
    expect(document.querySelector('[data-compare-row="r1:1"]')).not.toHaveClass(
      'text-muted-foreground'
    )
    expect(
      within(document.querySelector('[data-compare-row="r1:held"]') as HTMLElement).getAllByRole(
        'cell'
      )[1]
    ).toHaveTextContent('4 · $7,500 asked')
  })

  it('never asks for the compare or the trail without the rules permission (D76)', () => {
    granted = []
    renderAt('/aid/season/scenarios?compare=A1')
    expect(asked.every((a) => a.enabled === false)).toBe(true)
    expect(askedTrail.every((a) => a.enabled === false)).toBe(true)
  })
})

const withRequestSet2 = (): CompareState => ({ ...settled(), data: withRequestSet() })

function withRequestSet(): ApiAidScenarioCompare {
  const out = compareOut()
  return {
    ...out,
    columns: out.columns.map((c) => ({
      ...c,
      results: {
        ...c.results,
        request_set: {
          basis: 'date',
          through: '2027-02-01',
          label: 'requests received through Feb 1, 2027',
          left_out: 14,
          unknown: 2,
        },
      },
    })),
  }
}

describe('the request-set sentence (D138)', () => {
  it('says what every scenario figure counts, and that last season is as posted', () => {
    compareState = { ...settled(), data: withRequestSet() }
    renderAt('/aid/season/scenarios?compare=A1&through=2027-02-01&last=1')
    expect(
      screen.getByText(
        'Every scenario figure counts requests received through Feb 1, 2027: 14 left out, 2 with no received date left out too; last season is as posted.'
      )
    ).toBeInTheDocument()
  })

  it('leaves the last-season clause off when last season is not shown', () => {
    compareState = { ...settled(), data: withRequestSet() }
    renderAt('/aid/season/scenarios?compare=A1&through=2027-02-01')
    expect(
      screen.getByText(/^Every scenario figure counts requests received/)
    ).not.toHaveTextContent('last season')
  })
})

describe('the compare keeps its controls whatever the read does (I1)', () => {
  it('shows a refused request set under the toolbar, which stays usable', async () => {
    compareState = {
      ...settled(),
      data: undefined,
      error: new AidApiError(
        "2027's approved rules set no application deadline: choose a received-through date",
        422
      ),
    }
    renderAt('/aid/season/scenarios?compare=A1&through=deadline')
    expect(screen.getByText(/choose a received-through date/)).toBeInTheDocument()
    expect(screen.getByLabelText('Received through')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Every frozen request' }))
    expect(params().has('through')).toBe(false)
  })

  it('keeps the toolbar on screen while the first read is out', () => {
    compareState = { ...settled(), data: undefined, isLoading: true }
    renderAt('/aid/season/scenarios?compare=A1')
    expect(screen.getByRole('button', { name: 'By the Round 1 deadline' })).toBeInTheDocument()
    expect(screen.queryByTestId('scenario-compare-table')).toBeNull()
  })

  it('keeps the previous table showing, marked stale, while the next one loads', () => {
    compareState = { ...settled(), isPlaceholderData: true }
    renderAt('/aid/season/scenarios?compare=A1')
    const table = screen.getByTestId('scenario-compare-table')
    expect(table).toHaveAttribute('data-stale')
    expect(screen.getByText('Updating…')).not.toHaveClass('invisible')
  })

  it('keeps the Updating slot reserved, so nothing jumps, and dims the sentence with the table', () => {
    compareState = { ...withRequestSet2(), isPlaceholderData: true }
    renderAt('/aid/season/scenarios?compare=A1&through=2027-02-01')
    expect(screen.getByText(/^Every scenario figure counts/)).toHaveClass('opacity-60')
    cleanup()
    compareState = withRequestSet2()
    renderAt('/aid/season/scenarios?compare=A1&through=2027-02-01')
    expect(screen.getByText('Updating…')).toHaveClass('invisible')
    expect(screen.getByText(/^Every scenario figure counts/)).not.toHaveClass('opacity-60')
  })

  it('does not mark a settled table stale', () => {
    renderAt('/aid/season/scenarios?compare=A1')
    expect(screen.getByTestId('scenario-compare-table')).not.toHaveAttribute('data-stale')
  })

  it("drops a code the workspace doesn't keep from the request and the URL, and says so", () => {
    renderAt('/aid/season/scenarios?compare=A1,Z9')
    expect(asked.at(-1)?.codes).toEqual(['A1'])
    expect(params().get('compare')).toBe('A1')
    expect(
      screen.getByText("Z9 isn't kept in 2027, so it was left out of the compare.")
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compare (draft + 1)' })).toBeInTheDocument()
    expect(screen.getByTestId('nav')).toHaveTextContent('REPLACE')
  })

  it('says it in the plural for several dropped codes', () => {
    renderAt('/aid/season/scenarios?compare=A1,Z9,Y8')
    expect(
      screen.getByText("Z9, Y8 aren't kept in 2027, so they were left out of the compare.")
    ).toBeInTheDocument()
  })

  it('clears the compare param when every code is gone', () => {
    renderAt('/aid/season/scenarios?compare=Z9')
    expect(params().has('compare')).toBe(false)
    expect(asked.at(-1)?.codes).toEqual([])
  })
})

describe("last season's column (I2)", () => {
  it('reads — in Held and a real figure in In no tier, never a held count', () => {
    renderAt('/aid/season/scenarios?compare=A1&last=1&tiers=1')
    const held = within(document.querySelector('[data-compare-row="r1:held"]') as HTMLElement)
    expect(held.getAllByRole('cell').at(-1)).toHaveTextContent('—')
    const none = within(document.querySelector('[data-compare-row="r1:none"]') as HTMLElement)
    expect(none.getAllByRole('cell').at(-1)).toHaveTextContent('$1,200')
  })

  it('heads the column with the server\'s label, which says "every request" while a set is on', () => {
    const out = compareOut()
    if (!out.last_season) throw new Error('the fixture has last season')
    compareState = {
      ...settled(),
      data: {
        ...out,
        last_season: { ...out.last_season, label: `${out.last_season.label}, every request` },
      },
    }
    renderAt('/aid/season/scenarios?compare=A1&last=1&through=deadline')
    expect(
      screen.getByRole('columnheader', { name: '2026, posted (as of Jan 3, 2027), every request' })
    ).toBeInTheDocument()
  })

  it('reads its label, and — in every by-tier cell, when it is not loaded', () => {
    const out = compareOut()
    compareState = {
      ...settled(),
      data: {
        ...out,
        last_season: {
          year: 2026,
          loaded: false,
          label: '2026 is not loaded yet',
          rules_version: null,
          view: null,
        },
      },
    }
    renderAt('/aid/season/scenarios?compare=A1&last=1&tiers=1')
    expect(screen.getByRole('columnheader', { name: '2026 is not loaded yet' })).toBeInTheDocument()
    for (const key of ['r1:held', 'r1:none', 'r1:1']) {
      const row = document.querySelector(`[data-compare-row="${key}"]`) as HTMLElement
      expect(within(row).getAllByRole('cell').at(-1)).toHaveTextContent('—')
    }
  })
})

describe('the Received-through date box (D138)', () => {
  it('writes the day on leaving the box or Enter, never per change', () => {
    renderAt('/aid/season/scenarios?compare=A1')
    const box = screen.getByLabelText('Received through')
    fireEvent.change(box, { target: { value: '2027-02-01' } })
    expect(params().has('through')).toBe(false)
    fireEvent.blur(box)
    expect(params().get('through')).toBe('2027-02-01')
    expect(asked.at(-1)?.set).toEqual({ kind: 'date', date: '2027-02-01' })
    fireEvent.change(box, { target: { value: '2027-02-15' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(params().get('through')).toBe('2027-02-15')
    expect(screen.getByTestId('nav')).toHaveTextContent('REPLACE')
  })

  it('puts a year-first typing pass (0002-…) back instead of asking for it', () => {
    renderAt('/aid/season/scenarios?compare=A1&through=2027-02-01')
    const box = screen.getByLabelText('Received through')
    fireEvent.change(box, { target: { value: '0002-02-01' } })
    fireEvent.blur(box)
    expect(params().get('through')).toBe('2027-02-01')
    expect(box).toHaveValue('2027-02-01')
  })

  it('puts a partly erased box back to the URL day, and clears only a truly empty one', () => {
    renderAt('/aid/season/scenarios?compare=A1&through=2027-02-01')
    const box = screen.getByLabelText('Received through')
    Object.defineProperty(box, 'validity', { value: { badInput: true }, configurable: true })
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)
    expect(params().get('through')).toBe('2027-02-01')
    expect(box).toHaveValue('2027-02-01')
    Object.defineProperty(box, 'validity', { value: { badInput: false }, configurable: true })
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)
    expect(params().has('through')).toBe(false)
  })

  it.each([
    ['blur', (box: HTMLElement) => fireEvent.blur(box)],
    ['Enter', (box: HTMLElement) => fireEvent.keyDown(box, { key: 'Enter' })],
  ])('resets the DOM of a partly typed box when the URL has no day, on %s', (_name, leave) => {
    renderAt('/aid/season/scenarios?compare=A1')
    const box = screen.getByLabelText('Received through')
    const sets: string[] = []
    Object.defineProperty(box, 'validity', { value: { badInput: true }, configurable: true })
    Object.defineProperty(box, 'value', {
      get: () => sets[sets.length - 1] ?? '',
      set: (next: string) => sets.push(next),
      configurable: true,
    })
    leave(box)
    expect(sets).toContain('')
    expect(params().has('through')).toBe(false)
  })
})

describe('the trail (D38)', () => {
  it('lists every released setting with who and when, and loads any row back', async () => {
    renderAt('/aid/season/scenarios?panel=trail')
    const panel = screen.getByTestId('scenario-trail')
    expect(within(panel).getByText('shift every tier 0 pts → −5 pts')).toBeInTheDocument()
    expect(within(panel).getByText(/figures from an older snapshot/)).toBeInTheDocument()
    const row = panel.querySelector('[data-trail-row="trail0000000001"]') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Load' }))
    expect(load).toHaveBeenCalledWith({ trail_row: 'trail0000000001' })
  })

  it('wraps What changed: no nowrap on that cell (I3)', () => {
    renderAt('/aid/season/scenarios?panel=trail')
    const cell = screen.getByText('shift every tier 0 pts → −5 pts').closest('td') as HTMLElement
    expect(cell.className).not.toContain('whitespace-nowrap')
  })

  it('numbers the rows oldest first, shows camp time, and highlights the one the draft is on', () => {
    renderAt('/aid/season/scenarios?panel=trail')
    const newest = document.querySelector('[data-trail-row="trail0000000002"]') as HTMLElement
    const current = document.querySelector('[data-trail-row="trail0000000001"]') as HTMLElement
    expect(within(newest).getAllByRole('cell')[0]).toHaveTextContent('2')
    expect(within(current).getAllByRole('cell')[0]).toHaveTextContent('1')
    expect(newest).toHaveTextContent('Jan 15 09:03')
    expect(current.className).toContain(ROW_HIGHLIGHT)
    expect(newest.className).not.toContain(ROW_HIGHLIGHT)
  })

  it('reads the trail only with a draft on screen (m2)', () => {
    ws = workspace({ draft: null })
    renderAt('/aid/season/scenarios?panel=trail')
    expect(askedTrail.every((a) => a.enabled === false)).toBe(true)
  })

  it.each([
    [1, 'Trail (1 change)'],
    [2, 'Trail (2 changes)'],
  ])('counts %i in the pill, singular for one', (total, name) => {
    trail = { ...TRAIL, total }
    renderAt('/aid/season/scenarios?panel=trail')
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  })

  it('says so when a page holds no rows, rather than a header-only table', () => {
    trail = { ...TRAIL, total: 0, rows: [] }
    renderAt('/aid/season/scenarios?panel=trail')
    expect(screen.getByText("Nothing recorded in your draft's trail yet.")).toBeInTheDocument()
    expect(document.querySelector('[data-trail-row]')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'When' })).toBeNull()
  })

  it('keeps the page showing, dimmed, with its Updating slot reserved, while the next loads', () => {
    renderAt('/aid/season/scenarios?panel=trail')
    expect(screen.getByText('Updating…')).toHaveClass('invisible')
    expect(screen.getByTestId('scenario-trail-table')).not.toHaveAttribute('data-stale')
    cleanup()
    trailStale = true
    renderAt('/aid/season/scenarios?panel=trail')
    expect(screen.getByText('Updating…')).not.toHaveClass('invisible')
    expect(screen.getByTestId('scenario-trail-table')).toHaveAttribute('data-stale')
  })

  it.each([
    ['past the last page', '9', '3'],
    ['below 1', '0', null],
    ['negative', '-2', null],
    ['not a number', 'abc', null],
    ['page 1 spelled out', '1', null],
    ['a real page', '2', '2'],
  ])('reads a trail_page %s as the nearest valid page, replacing the URL', (_n, raw, expected) => {
    trail = { ...TRAIL, total: 120 }
    renderAt(`/aid/season/scenarios?panel=trail&trail_page=${raw}`)
    expect(params().get('trail_page')).toBe(expected)
    if (raw !== expected) expect(screen.getByTestId('nav')).toHaveTextContent('REPLACE')
  })

  it('reads the trail only while it is the open panel', () => {
    renderAt('/aid/season/scenarios')
    expect(askedTrail.every((a) => a.enabled === false)).toBe(true)
    expect(screen.queryByTestId('scenario-trail')).toBeNull()
  })

  it('pages through the trail in the URL, replacing, and page 1 leaves it clean', async () => {
    trail = { ...TRAIL, total: 120 }
    renderAt('/aid/season/scenarios?panel=trail')
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Older' }))
    expect(params().get('trail_page')).toBe('2')
    expect(screen.getByTestId('nav')).toHaveTextContent('REPLACE')
  })
})
