/**
 * Fit to budget, All settings and "Make it the rules draft" on screen (spec §7.4, §7.5; D39, D119).
 * The workspace and the draft's work are mocked; each test sets the fit's answer or the preview.
 */
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LiveResults } from '../../../../hooks/camperships/useAidScenarioDraft'
import { AidWriteError } from '../../../../services/camperships/aidApi'
import type {
  ApiAidPromotionPreview,
  ApiAidRulesDocumentIn,
  ApiAidScenarioFit,
} from '../../../../types/api-types'
import { RULES_DOCUMENT } from '../rules/rulesFixtures'
import { NO_PENDING, type Pending } from './scenarioModel'
import { compareOut, results, scenarioDraft, workspace } from './scenarioFixtures'
import { ScenariosTab } from './ScenariosTab'

vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))
let draftTrail = 'trail0000000001'
let lockedSections: string[] = []
vi.mock('../../../../hooks/camperships/useAidRules', () => ({
  useAidRulesDraft: () => ({
    data: {
      sections: lockedSections.map((section) => ({ section, status: { state: 'locked' } })),
    },
  }),
}))
vi.mock('../../../../hooks/camperships/useAidScenarios', () => ({
  useAidScenarios: () => ({
    data: workspace({ draft: scenarioDraft({ trail_id: draftTrail }) }),
    isLoading: false,
    error: null,
  }),
  useAidScenarioSensitivity: () => ({ data: { results: results(735000), levers: [] } }),
}))
vi.mock('../../../../hooks/camperships/useAidScenarioCompare', () => ({
  useAidScenarioCompare: () => ({
    data: compareOut(),
    isLoading: false,
    isPlaceholderData: false,
    error: null,
  }),
  useAidScenarioTrail: () => ({ data: undefined, isLoading: true, error: null }),
}))
type Build = (current: ApiAidRulesDocumentIn) => ApiAidRulesDocumentIn
const adopt = vi.fn<
  (label: string, build: Build, options?: { readonly basedOn?: string }) => Promise<boolean>
>(() => Promise.resolve(true))
let pending: Pending = NO_PENDING
let busy: string | null = null
let writeError: string | null = null
let writeSource: string | null = null
vi.mock('../../../../hooks/camperships/useAidScenarioDraft', () => ({
  useAidScenarioDraft: () => ({
    pending,
    live: { status: 'idle' } as LiveResults,
    busy,
    error: writeError,
    errorSource: writeSource,
    nothingToFreeze: false,
    move: vi.fn(),
    release: vi.fn(() => Promise.resolve(true)),
    load: vi.fn(() => Promise.resolve(true)),
    keep: vi.fn(() => Promise.resolve(true)),
    adopt,
    freeze: vi.fn(() => Promise.resolve(true)),
    start: vi.fn(() => Promise.resolve(true)),
  }),
}))
let fitAnswer: ApiAidScenarioFit | undefined
let preview: ApiAidPromotionPreview | undefined
const fitAsked: unknown[] = []
const promoted: unknown[] = []
let promoteRefusal: string | null = null
let promoteStatus = 409
let promoteBusy = false
vi.mock('../../../../hooks/camperships/useAidPromotion', () => ({
  useAidScenarioFit: () => ({
    data: fitAnswer,
    error: null,
    isPending: false,
    mutate: (document: unknown) => fitAsked.push(document),
    reset: vi.fn(),
  }),
  useAidPromotionPreview: (code: string | null) => ({
    data: code === null ? undefined : preview,
    isLoading: false,
    error: null,
  }),
  useAidMakeRulesDraft: () => ({
    isPending: promoteBusy,
    reset: vi.fn(),
    mutate: (
      vars: unknown,
      handlers: { onSuccess: (draft: { version: number }) => void; onError: (error: Error) => void }
    ) => {
      promoted.push(vars)
      if (promoteRefusal === null) handlers.onSuccess({ version: 5 })
      else handlers.onError(new AidWriteError(promoteRefusal, promoteStatus))
    },
  }),
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

function renderAt(path = '/aid/season/scenarios') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ScenariosTab />
    </MemoryRouter>
  )
}

const PREVIEW: ApiAidPromotionPreview = {
  code: 'A1',
  origin_version: 3,
  base_version: 4,
  sections: [
    {
      section: 'award_tables',
      changes: [
        { path: ['general', 'tiers', '2', 'r1_pct'], kind: 'changed', before: '55', after: '58' },
      ],
      warning: {
        kind: 'unapproved_edit',
        by: 'Test User',
        at: '2027-01-21T17:00:00Z',
        via: 'B2',
        token: 'tok-1',
      },
    },
  ],
  unchanged: ['income', 'tiers'],
}

const FITS: ApiAidScenarioFit = {
  tier_shift: -4.5,
  outcome: 'fits',
  tightest_pool: 'pool_b',
  tried: 11,
  document: { ...RULES_DOCUMENT, year: 2027 },
  results: results(800000),
  report: { issues: [] },
}

beforeEach(() => {
  fitAnswer = undefined
  preview = PREVIEW
  fitAsked.length = 0
  promoted.length = 0
  promoteRefusal = null
  promoteStatus = 409
  promoteBusy = false
  draftTrail = 'trail0000000001'
  lockedSections = []
  pending = NO_PENDING
  busy = null
  writeError = null
  writeSource = null
  adopt.mockReset()
  adopt.mockResolvedValue(true)
})

describe('Fit to budget (D119)', () => {
  it('says the shift it found, and records the fitted document only on "Use it", on the trail row it was fitted on', async () => {
    // The mutation's answer is mocked as already there; the click is what asks (and notes the row).
    fitAnswer = FITS
    renderAt()
    const fit = screen.getByTestId('fit-to-budget')
    await userEvent.click(within(fit).getByRole('button', { name: /^Fit to budget/ }))
    expect(fitAsked).toEqual([workspace().draft?.document])
    expect(
      within(fit).getByText(/Shifting every tier −4.5 pts uses Round 1's allocation/)
    ).toBeInTheDocument()
    expect(within(fit).getByText(/Tightest pool: Pool B/)).toBeInTheDocument()
    expect(adopt).not.toHaveBeenCalled()
    await userEvent.click(within(fit).getByRole('button', { name: 'Use it' }))
    expect(adopt).toHaveBeenCalledTimes(1)
    const [label, build, options] = adopt.mock.calls[0]!
    expect(label).toBe('Recording…')
    expect(build(RULES_DOCUMENT)).toBe(FITS.document)
    expect(options).toEqual({ basedOn: 'trail0000000001' })
  })

  it("offers nothing to use when even the range's end doesn't fit", () => {
    fitAnswer = {
      tier_shift: -100,
      outcome: 'over_at_lowest',
      tightest_pool: null,
      tried: 1,
      document: RULES_DOCUMENT,
      results: results(900000),
      report: { issues: [] },
    }
    renderAt()
    expect(
      screen.getByText('Even the lowest shift (−100 pts) leaves Round 1 over its allocation.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull()
  })

  it('is held while a slider is moving: neither asking nor "Use it" goes through', async () => {
    fitAnswer = FITS
    const view = renderAt()
    const fit = screen.getByTestId('fit-to-budget')
    await userEvent.click(within(fit).getByRole('button', { name: /^Fit to budget/ }))
    expect(within(fit).getByRole('button', { name: 'Use it' })).toBeEnabled()
    pending = { ...NO_PENDING, tierShift: -2 }
    view.rerender(
      <MemoryRouter initialEntries={['/aid/season/scenarios']}>
        <ScenariosTab />
      </MemoryRouter>
    )
    expect(within(fit).getByRole('button', { name: /^Fit to budget/ })).toBeDisabled()
    expect(within(fit).getByRole('button', { name: 'Use it' })).toBeDisabled()
  })
})

describe('All settings (D39: one editor, two homes)', () => {
  async function typeMinimum() {
    renderAt()
    const all = screen.getByTestId('all-settings')
    await userEvent.click(within(all).getByRole('button', { name: /Minimum award and limits/ }))
    const box = within(all).getByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    return all
  }

  it('opens the same editor against the scenario draft, says it is not the rules, and records the draft', async () => {
    const all = await typeMinimum()
    expect(
      within(all).getByText(
        'Editing Minimum award and limits in your scenario draft (from B), not the rules'
      )
    ).toBeInTheDocument()
    await userEvent.click(within(all).getByRole('button', { name: 'Save' }))
    expect(adopt).toHaveBeenCalledTimes(1)
    const [label, build, options] = adopt.mock.calls[0]!
    expect(label).toBe('Recording…')
    // The section is named as the source, so a refusal is shown in its own editor.
    expect(options).toEqual({ source: 'awards' })
    // The builder works on the draft as it is when the write runs, not as it was when the box opened.
    const other = { ...RULES_DOCUMENT, year: 2030 }
    expect(build(other)).toEqual({
      ...other,
      awards: { ...RULES_DOCUMENT.awards, minimum: '150' },
    })
  })

  it('holds Save while a slider is moving or a write runs', async () => {
    const all = await typeMinimum()
    expect(within(all).getByRole('button', { name: 'Save' })).toBeEnabled()
    pending = { ...NO_PENDING, tierShift: -2 }
    renderAt()
    const held = screen.getAllByTestId('all-settings')[1]!
    await userEvent.click(within(held).getByRole('button', { name: /Minimum award and limits/ }))
    const box = within(held).getByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    expect(within(held).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('Make it the rules draft (D39; Decision 21)', () => {
  it('lists each change, makes a replaced edit be confirmed, and sends its token', async () => {
    renderAt('/aid/season/scenarios?compare=A1')
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the rules draft…' }))
    const dialog = screen.getByTestId('promotion-preview')
    expect(
      within(dialog).getByText('General › Tiers › Tier 2 › Round 1 %: 55% → 58%')
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Unchanged: the other 2 sections.')).toBeInTheDocument()
    const make = screen.getByRole('button', { name: 'Make it the rules draft' })
    expect(make).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.click(make)
    expect(promoted[0]).toEqual({
      code: 'A1',
      body: { base_version: 4, acknowledged: { award_tables: 'tok-1' } },
    })
    expect(screen.getByTestId('promotion-done')).toHaveTextContent(
      "A1's changes are in the rules draft, v5."
    )
    expect(screen.getByRole('link', { name: /Rules/ })).toHaveAttribute(
      'href',
      '/aid/season/rules?year=2027'
    )
    // Done closes it.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByTestId('promotion-done')).toBeNull()
    expect(screen.queryByTestId('promotion-preview')).toBeNull()
  })

  it('has no promote control on the draft column', () => {
    renderAt('/aid/season/scenarios?compare=A1')
    expect(screen.getAllByRole('button', { name: /the rules draft…$/ })).toHaveLength(1)
  })

  it('forgets a tick when it is closed and opened again', async () => {
    renderAt('/aid/season/scenarios?compare=A1')
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the rules draft…' }))
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('promotion-preview')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the rules draft…' }))
    expect(within(screen.getByTestId('promotion-preview')).getByRole('checkbox')).not.toBeChecked()
  })

  it('writes nothing on a 409, and a tick on a warning that changed since no longer counts', async () => {
    promoteRefusal = 'The rules draft is version 5 now, not 4: look at the changes again'
    const view = renderAt('/aid/season/scenarios?compare=A1')
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the rules draft…' }))
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make it the rules draft' }))
    expect(screen.getByTestId('promotion-refused')).toHaveTextContent('Nothing was changed.')

    // The rules write's invalidation refreshes the preview: the section was re-edited, so a new token.
    const section = PREVIEW.sections[0]!
    preview = {
      ...PREVIEW,
      base_version: 5,
      sections: [{ ...section, warning: { ...section.warning!, token: 'tok-2' } }],
    }
    view.rerender(
      <MemoryRouter initialEntries={['/aid/season/scenarios?compare=A1']}>
        <ScenariosTab />
      </MemoryRouter>
    )
    expect(within(screen.getByTestId('promotion-preview')).getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Make it the rules draft' })).toBeDisabled()
  })
})

describe('the Fit answer belongs to the draft it was fitted on (m5)', () => {
  it('goes when the draft moves on, and no "Use it" is offered for it', async () => {
    fitAnswer = FITS
    const view = renderAt()
    const fit = screen.getByTestId('fit-to-budget')
    await userEvent.click(within(fit).getByRole('button', { name: /^Fit to budget/ }))
    expect(within(fit).getByRole('button', { name: 'Use it' })).toBeInTheDocument()
    draftTrail = 'trail0000000002'
    view.rerender(
      <MemoryRouter initialEntries={['/aid/season/scenarios']}>
        <ScenariosTab />
      </MemoryRouter>
    )
    expect(within(fit).queryByRole('button', { name: 'Use it' })).toBeNull()
    expect(within(fit).queryByText(/Shifting every tier/)).toBeNull()
    expect(within(fit).getByText(/Your draft changed since/)).toBeInTheDocument()
  })
})

describe('while a write runs (m7)', () => {
  it('holds Fit, "Use it" and All settings Save', async () => {
    fitAnswer = FITS
    const view = renderAt()
    const fit = screen.getByTestId('fit-to-budget')
    await userEvent.click(within(fit).getByRole('button', { name: /^Fit to budget/ }))
    const all = screen.getByTestId('all-settings')
    await userEvent.click(within(all).getByRole('button', { name: /Minimum award and limits/ }))
    const box = within(all).getByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    expect(within(all).getByRole('button', { name: 'Save' })).toBeEnabled()
    busy = 'Recording…'
    view.rerender(
      <MemoryRouter initialEntries={['/aid/season/scenarios']}>
        <ScenariosTab />
      </MemoryRouter>
    )
    expect(within(fit).getByRole('button', { name: /^Fit to budget/ })).toBeDisabled()
    expect(within(fit).getByRole('button', { name: 'Use it' })).toBeDisabled()
    // A running write turns Save into "Saving…", held.
    expect(within(all).getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })
})

describe('All settings holds its list while a section is open (Decision 15)', () => {
  it('disables every section name, the open one included, says why, and keeps the typing; Cancel is the way out', async () => {
    renderAt()
    const all = screen.getByTestId('all-settings')
    await userEvent.click(within(all).getByRole('button', { name: /Minimum award and limits/ }))
    const box = within(all).getByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    const other = within(all).getByRole('button', { name: /Outside grants/ })
    expect(other).toBeDisabled()
    expect(within(all).getByRole('button', { name: /Minimum award and limits/ })).toBeDisabled()
    expect(within(all).getByText('Save or cancel the edit first.')).toBeInTheDocument()
    expect(other).toHaveClass('disabled:opacity-50')
    await userEvent.click(other)
    expect(within(all).getByRole('textbox', { name: 'Minimum award' })).toHaveValue('150')
    await userEvent.click(within(all).getByRole('button', { name: 'Cancel' }))
    expect(within(all).queryByText('Save or cancel the edit first.')).toBeNull()
    expect(within(all).getByRole('button', { name: /Outside grants/ })).toBeEnabled()
  })

  it('closes the section it saved when the save lands, never one opened since', async () => {
    let land: (landed: boolean) => void = () => undefined
    adopt.mockImplementationOnce(() => new Promise<boolean>((resolve) => (land = resolve)))
    renderAt()
    const all = screen.getByTestId('all-settings')
    await userEvent.click(within(all).getByRole('button', { name: /Minimum award and limits/ }))
    const box = within(all).getByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    await userEvent.click(within(all).getByRole('button', { name: 'Save' }))
    // The double's Cancel isn't held by a running write as the real hook's busy is: leave and open another.
    await userEvent.click(within(all).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(all).getByRole('button', { name: /Outside grants/ }))
    await act(async () => {
      land(true)
      await Promise.resolve()
    })
    expect(
      screen.getByText('Editing Outside grants in your scenario draft (from B), not the rules')
    ).toBeInTheDocument()
  })
})

describe('a refused save says its words once, inside its own editor, and no other write does (m6)', () => {
  const openMinimum = async () => {
    const view = renderAt()
    const all = screen.getByTestId('all-settings')
    await userEvent.click(within(all).getByRole('button', { name: /Minimum award and limits/ }))
    return { view, all }
  }
  const again = (view: ReturnType<typeof renderAt>) =>
    view.rerender(
      <MemoryRouter initialEntries={['/aid/season/scenarios']}>
        <ScenariosTab />
      </MemoryRouter>
    )

  it("shows a save's refusal once, in its editor, and not at the top", async () => {
    writeError = 'The draft moved since: try again'
    writeSource = 'awards'
    const { all } = await openMinimum()
    expect(within(all).getByText(writeError)).toBeInTheDocument()
    expect(screen.getAllByText(writeError)).toHaveLength(1)
  })

  it("shows another write's error at the top, never inside the open editor, even with the same words", async () => {
    writeError = 'Same words'
    writeSource = null
    const { all } = await openMinimum()
    expect(within(all).queryByText(writeError)).toBeNull()
    expect(screen.getAllByText(writeError)).toHaveLength(1)
    // A refused save with the same words, then another write's: the second is not the save's.
    writeSource = 'awards'
    expect(screen.getAllByText(writeError)).toHaveLength(1)
  })

  it('does not follow a refused save into the next section opened', async () => {
    writeError = 'Minimum refused'
    writeSource = 'awards'
    const { view, all } = await openMinimum()
    expect(within(all).getByText(writeError)).toBeInTheDocument()
    await userEvent.click(within(all).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(all).getByRole('button', { name: /Outside grants/ }))
    again(view)
    expect(within(all).queryByText(writeError)).toBeNull()
    expect(screen.getAllByText(writeError)).toHaveLength(1)
  })

  it('never flashes a save refusal at the top while its editor is open', async () => {
    writeError = 'Refused'
    writeSource = 'awards'
    const { all } = await openMinimum()
    const top = screen.getAllByText(writeError).filter((el) => !all.contains(el))
    expect(top).toHaveLength(0)
  })
})

describe('the promotion dialog (review m3, m4, m7, m8, m9, ⚠1)', () => {
  const open = async (path = '/aid/season/scenarios?compare=A1') => {
    const view = renderAt(path)
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the rules draft…' }))
    return view
  }

  it('right-aligns the promote link under its column', () => {
    renderAt('/aid/season/scenarios?compare=A1')
    expect(screen.getByRole('button', { name: 'Make A1 the rules draft…' })).toHaveClass(
      'text-right'
    )
  })

  it('cannot be cancelled or escaped while the write runs', async () => {
    promoteBusy = true
    await open()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByTestId('promotion-preview')).toBeInTheDocument()
  })

  it('says "Nothing was changed" on a refusal, and not when it cannot tell', async () => {
    promoteRefusal = 'No such option'
    promoteStatus = 422
    await open()
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make it the rules draft' }))
    expect(screen.getByTestId('promotion-refused')).toHaveTextContent('Nothing was changed.')
  })

  it("says it couldn't tell whether it was saved on any other failure, and links the Rules tab on the same as_of", async () => {
    promoteRefusal = 'Server exploded'
    promoteStatus = 500
    await open('/aid/season/scenarios?compare=A1&as_of=2026-01-15')
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make it the rules draft' }))
    const unknown = screen.getByTestId('promotion-unknown')
    expect(unknown).toHaveTextContent("Server exploded. Couldn't tell whether it was saved")
    expect(unknown).not.toHaveTextContent('Nothing was changed')
    expect(within(unknown).getByRole('link', { name: /Rules/ })).toHaveAttribute(
      'href',
      '/aid/season/rules?year=2027&as_of=2026-01-15'
    )
  })

  it('keeps a past as_of on the Rules link after a promotion', async () => {
    await open('/aid/season/scenarios?compare=A1&as_of=2026-01-15')
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make it the rules draft' }))
    expect(screen.getByRole('link', { name: /Rules/ })).toHaveAttribute(
      'href',
      '/aid/season/rules?year=2027&as_of=2026-01-15'
    )
  })

  it('says a locked section may start a new version and posted amounts stand', async () => {
    lockedSections = ['award_tables']
    await open()
    expect(
      within(screen.getByTestId('promotion-preview')).getByText(
        'Award tables (Round 1 %) is locked by a posted round: making this the rules draft may start a new version of it. Posted amounts stand.'
      )
    ).toBeInTheDocument()
  })

  it('says nothing about a lock when no changed section is locked, and states no version it cannot promise', async () => {
    await open()
    const dialog = screen.getByTestId('promotion-preview')
    expect(within(dialog).queryByText(/locked by a posted round/)).toBeNull()
    expect(dialog).not.toHaveTextContent('(v4)')
  })

  it('says what an empty list means accurately', async () => {
    preview = { ...PREVIEW, sections: [], unchanged: ['income'] }
    await open()
    expect(
      within(screen.getByTestId('promotion-preview')).getByText(
        'Nothing to change: what this option changed is already in the rules draft.'
      )
    ).toBeInTheDocument()
  })
})
