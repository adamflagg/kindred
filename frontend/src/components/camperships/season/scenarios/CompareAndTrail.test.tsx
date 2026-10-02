/**
 * Scenarios' compare and trail on screen (spec §7.4; D38, D138; RPT-17). The reads are mocked with
 * scenarioFixtures; the URL holds which panel, which options, the request set and last season.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Permission } from '../../../../constants/permissions'
import type { LiveResults } from '../../../../hooks/camperships/useAidScenarioDraft'
import type { AidRequestSet } from '../../../../services/camperships/aidApi'
import type { ApiAidScenarioTrailPage } from '../../../../types/api-types'
import { NO_PENDING } from './scenarioModel'
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
vi.mock('../../../../hooks/camperships/useAidScenarioCompare', () => ({
  useAidScenarioCompare: (
    codes: readonly string[],
    set: AidRequestSet,
    last: boolean,
    options: { enabled?: boolean } = {}
  ) => {
    asked.push({ codes, set, last, enabled: options.enabled })
    return { data: compareOut(), isLoading: false, error: null }
  },
  useAidScenarioTrail: (page: number, options: { enabled?: boolean } = {}) => {
    askedTrail.push({ page, enabled: options.enabled })
    return { data: trail, isLoading: false, error: null }
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
    expect(screen.getByText(/Four are already ticked/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Compare B1' }))
    expect(params().get('compare')).toBe('A,A1,B')
    expect(screen.queryByText(/Four are already ticked/)).toBeNull()
  })

  it('says how to compare, in the kept card', () => {
    renderAt('/aid/season/scenarios')
    expect(screen.getByText(/Tick up to four to compare beside your draft/)).toBeInTheDocument()
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
    expect(screen.getByRole('columnheader', { name: '2026 as posted' })).toBeInTheDocument()
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
