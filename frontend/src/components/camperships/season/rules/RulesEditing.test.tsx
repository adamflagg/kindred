/**
 * Editing the rules (spec §7.5; D39) and the answer when someone else changed the
 * section (Decisions 16–17), on screen. The reads are mocked with rulesFixtures' invented 2027 rules.
 * `server` is the queue of drafts the fresh reads return (open, the check before sending, the re-read
 * after a 409), the last one repeating; an Error in it is a failed read. Each test sets how the next
 * write answers.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidWriteError } from '../../../../services/camperships/aidApi'
import type { ApiAidRulesDraft } from '../../../../types/api-types'
import { isRulesSection } from './rulesModel'
import { approvePrecondition, savePrecondition } from './precondition'
import { RULES_DOCUMENT, rulesDraft } from './rulesFixtures'
import { ApproveButton, SeasonChromeProvider } from '../SeasonChrome'
import { RulesTab } from './RulesTab'

interface Read<T> {
  data: T | undefined
  isLoading: boolean
  error: Error | null
}
let draft: Read<ApiAidRulesDraft>
vi.mock('../../../../hooks/camperships/useAidRules', () => ({
  useAidApprovedRules: () => ({ data: undefined, isLoading: true, error: null }),
  useAidRulesDraft: () => draft,
}))
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))
let year = 2027
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => year }))
vi.mock('../../../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: () => undefined,
}))

type Outcome = { kind: 'ok'; value: unknown } | { kind: 'refused'; status: number; message: string }
let outcome: Outcome
const calls: Array<{ hook: string; vars: unknown }> = []
interface Handlers {
  onSuccess?: (value: unknown) => void
  onError?: (error: Error) => void
}
/** Set true to render the writes as in flight (the busy holds). */
let pending = false
function fakeWrite(hook: string) {
  return {
    isPending: pending,
    mutate: (vars: unknown, handlers?: Handlers) => {
      calls.push({ hook, vars })
      if (outcome.kind === 'ok') handlers?.onSuccess?.(outcome.value)
      else handlers?.onError?.(new AidWriteError(outcome.message, outcome.status))
    },
  }
}
let server: Array<ApiAidRulesDraft | Error | Promise<ApiAidRulesDraft>>
function freshRead(): Promise<ApiAidRulesDraft> {
  const next = server.length > 1 ? server.shift() : server[0]
  if (next === undefined) return Promise.resolve(rulesDraft())
  if (next instanceof Error) return Promise.reject(next)
  return next instanceof Promise ? next : Promise.resolve(next)
}
vi.mock('../../../../hooks/camperships/useAidRulesWrites', () => ({
  useAidSaveRulesSection: () => fakeWrite('save'),
  useAidApproveRules: () => fakeWrite('approve'),
  useAidStartRulesFromLastYear: () => fakeWrite('start'),
  useFreshAidRulesDraft: () => freshRead,
}))

/** Opens a card's editor from its own Edit… (the page is chapters of cards, so there are many). */
const editCard = (section: string) =>
  userEvent.click(
    within(screen.getByTestId(`card-head-${section}`)).getByRole('button', { name: 'Edit…' })
  )

const CONFLICT = 'Someone else changed this; reload and try again'

/** The page's chrome around the tab, as AidSeasonPage mounts it: Approve… lives there, not in the tab (spec §4). */
function Page() {
  const [params] = useSearchParams()
  const section = params.get('section')
  return (
    <SeasonChromeProvider section={isRulesSection(section) ? section : 'budget'} tab="rules">
      <ApproveButton />
      <RulesTab />
    </SeasonChromeProvider>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Page />
    </MemoryRouter>
  )
}

/** The draft as someone else's save left it: v5, with the minimum award moved to $120. */
function movedDraft(): ApiAidRulesDraft {
  const base = rulesDraft()
  return {
    ...base,
    version: 5,
    // The server's fingerprint moves with the section's content: the NEW one is what a rebase must send.
    sections: base.sections.map((s) =>
      s.section === 'awards' ? { ...s, fingerprint: 'fp-awards-v5' } : s
    ),
    document: { ...base.document, awards: { ...RULES_DOCUMENT.awards, minimum: '120' } },
  }
}

/** The draft with the general award table's Round 1 % changed: someone else's edit to award_tables. */
function movedTableDraft(): ApiAidRulesDraft {
  const moved = rulesDraft()
  const table = {
    inherits: null,
    tiers: { '1': { r1_pct: '90' }, '2': { r1_pct: '50' }, '3': { r1_pct: '20' } },
    overrides: {},
  }
  return {
    ...moved,
    // The server's fingerprint moves with the content: sameSection compares it, not the document.
    sections: moved.sections.map((s) =>
      s.section === 'award_tables' ? { ...s, fingerprint: 'fp-award_tables-moved' } : s
    ),
    document: { ...moved.document, award_tables: { general: table } },
  }
}

beforeEach(() => {
  draft = { data: rulesDraft(), isLoading: false, error: null }
  outcome = { kind: 'ok', value: rulesDraft() }
  server = [rulesDraft()]
  calls.length = 0
  pending = false
  year = 2027
})

describe('editing a section (D39; Decisions 14–16)', () => {
  it('says which draft it edits, and saves the section with the version it opened', async () => {
    renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    expect(
      await screen.findByText('Editing Minimum award and named awards in the rules draft (v4)')
    ).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    expect(screen.getByText('was $100')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({
      hook: 'save',
      vars: {
        section: 'awards',
        body: {
          base_version: 4,
          ...savePrecondition(rulesDraft(), 'awards'),
          content: { ...RULES_DOCUMENT.awards, minimum: '150' },
        },
      },
    })
    expect(screen.getByTestId('rules-notice')).toHaveTextContent('Saved to the rules draft v4.')
  })

  it('answers a 422 from the server in a sentence naming the field, not its raw text', async () => {
    outcome = {
      kind: 'refused',
      status: 422,
      message: 'awards is not a valid section: awards.minimum: Value error, must not be negative',
    }
    renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Minimum award' }), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(
        'The rules draft refused this change: Minimum award: must not be negative.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/is not a valid section/)).toBeNull()
  })

  it('says a save landed in a new version when it would have changed approved rules in use', async () => {
    outcome = { kind: 'ok', value: { ...rulesDraft(), version: 5, branched_from: 4 } }
    renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Minimum award' }), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByTestId('rules-notice')).toHaveTextContent(
      'Saved as a new version, v5: the approved rules in use stay as they are until it is approved.'
    )
  })

  it("won't send a box it can't read, and says why in the box's own words", async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await editCard('award_tables')
    const tier = await screen.findByRole('textbox', {
      name: 'General › Tiers › Tier 2 › Round 1 %',
    })
    await userEvent.clear(tier)
    await userEvent.type(tier, '120')
    expect(screen.getByText('At most 100%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.clear(tier)
    await userEvent.type(tier, '12,50')
    expect(screen.getByText('Not a number')).toBeInTheDocument()
  })

  it('keeps names and lists as they are: only figures, yes/no and choices take a box', async () => {
    renderAt('/aid/season/rules?section=programs')
    await editCard('programs')
    const editor = await screen.findByTestId('section-editor')
    expect(within(editor).queryByRole('textbox')).toBeNull()
    expect(within(editor).getAllByRole('combobox').length).toBeGreaterThan(0)
    // Sessions are chips now (spec §6.2 E.8; Task 47), named as the read view names them (#15; no name here).
    expect(within(editor).getByText('Session 1000101')).toBeInTheDocument()
    expect(within(editor).getByText('Session 1000102')).toBeInTheDocument()
  })

  it("reads the rules' own names in the editor, as the read view does (#15)", async () => {
    renderAt('/aid/season/rules?section=programs')
    await editCard('programs')
    const editor = await screen.findByTestId('section-editor')
    // A pool reads its label, never its key; the key stays in what is saved. (The budget section left this tab.)
    expect(within(editor).queryAllByText('pool_a')).toHaveLength(0)
    expect(within(editor).getAllByText('Pool A').length).toBeGreaterThan(0)
  })

  it('says a locked section saves into a new version and posted amounts stand', async () => {
    renderAt('/aid/season/rules?section=income')
    await editCard('income')
    expect(
      await screen.findByText(
        'Locked: a posted round read it. Saving may start a new version of it. Posted amounts stand.'
      )
    ).toBeInTheDocument()
  })

  it('holds the other cards still while editing', async () => {
    renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    // The lead line's cue (review m2); no other card offers Edit….
    expect(screen.getAllByText('Save or cancel the edit first.')).toHaveLength(1)
    expect(screen.queryAllByRole('button', { name: 'Edit…' })).toHaveLength(0)
  })
})

describe('someone else changed the section (Decision 16; owner ruling 2026-10-02)', () => {
  async function typeMinimum(value: string) {
    renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    const box = await screen.findByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, value)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('sends nothing when the section moved since the editor opened, and keeps the typing', async () => {
    // Opened on v4; by Save, someone else has moved the minimum to $120 (v5).
    server = [rulesDraft(), movedDraft()]
    await typeMinimum('150')
    const conflict = await screen.findByTestId('rules-conflict')
    expect(conflict).toHaveTextContent(
      'Someone else changed the rules draft since you opened this section. Nothing was saved; your typing is kept.'
    )
    expect(conflict).toHaveTextContent('Minimum award: $100 → $120')
    expect(conflict).toHaveTextContent(
      'You both changed Minimum award: saving puts yours in place of theirs.'
    )
    expect(screen.getByRole('textbox', { name: 'Minimum award' })).toHaveValue('150')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(calls).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Put My Edit on v5' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      hook: 'save',
      vars: {
        body: {
          base_version: 5,
          ...savePrecondition(movedDraft(), 'awards'),
          content: { minimum: '150' },
        },
      },
    })
  })

  it("on the server's 409 reads the draft again, says what moved, and leads with its own words", async () => {
    outcome = { kind: 'refused', status: 409, message: CONFLICT }
    server = [rulesDraft(), rulesDraft(), movedDraft()]
    await typeMinimum('150')
    const conflict = await screen.findByTestId('rules-conflict')
    expect(conflict).toHaveTextContent(/^Someone else changed the rules draft/)
    expect(conflict).toHaveTextContent(CONFLICT)
    expect(await within(conflict).findByText('Minimum award: $100 → $120')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Minimum award' })).toHaveValue('150')
    expect(calls).toHaveLength(1)
  })

  it("never sticks: when what changed can't be read, it says so, keeps the typing, and tries again", async () => {
    outcome = { kind: 'refused', status: 409, message: CONFLICT }
    server = [rulesDraft(), rulesDraft(), new Error('Network down'), movedDraft()]
    await typeMinimum('150')
    const conflict = await screen.findByTestId('rules-conflict')
    expect(
      await within(conflict).findByText("Couldn't load what changed: Network down")
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Minimum award' })).toHaveValue('150')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    await userEvent.click(within(conflict).getByRole('button', { name: 'Try Again' }))
    expect(await within(conflict).findByText('Minimum award: $100 → $120')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Put My Edit on v5' })).toBeInTheDocument()
  })

  it('says you both changed a list when your edit is inside a list someone else changed', async () => {
    // Someone else changed a band's lower edge: the change is reported at the list's path
    // (['bands']), mine at ['bands','1','upper']. Overlap is `touches`, never equality.
    const base = rulesDraft()
    const bands = RULES_DOCUMENT.tiers.bands.map((b, i) => (i === 0 ? { ...b, lower: '1' } : b))
    server = [
      rulesDraft(),
      {
        ...base,
        version: 5,
        sections: base.sections.map((s) =>
          s.section === 'tiers' ? { ...s, fingerprint: 'fp-tiers-v5' } : s
        ),
        document: { ...base.document, tiers: { ...RULES_DOCUMENT.tiers, bands } },
      },
    ]
    renderAt('/aid/season/rules?section=tiers')
    await editCard('tiers')
    // Task 49 (spec §6.2 E.2): the tiers editor replaces the per-band boxes; the fixture's uneven bands open it by hand,
    // where band 2's "To" is "Tier 2 top". The "both changed" words still come from where the two edits overlap.
    const box = await screen.findByLabelText('Tier 2 top')
    await userEvent.clear(box)
    await userEvent.type(box, '45000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const conflict = await screen.findByTestId('rules-conflict')
    expect(conflict).toHaveTextContent(
      'You both changed Income bands: saving puts yours in place of theirs.'
    )
    expect(calls).toHaveLength(0)
  })
})

describe('approving sections (D39; Decision 17; owner ruling 2026-10-02)', () => {
  async function fillApproval() {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    expect(await within(form).findByRole('checkbox', { name: 'Round 1 award table' })).toBeChecked()
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 Section' }))
  }

  it('Esc closes the Approve form without approving', async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await within(screen.getByTestId('approve-form')).findByRole('checkbox', {
      name: 'Round 1 award table',
    })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('approve-form')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('approves the ticked draft sections with the note naming the body', async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    expect(await within(form).findByRole('checkbox', { name: 'Round 1 award table' })).toBeChecked()
    expect(within(form).getByRole('button', { name: 'Approve 1 Section' })).toBeDisabled()
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 Section' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({
      hook: 'approve',
      vars: {
        version: 4,
        body: {
          sections: ['award_tables'],
          note: 'Finance, Jan 22 meeting',
          ...approvePrecondition(rulesDraft(), ['award_tables']),
        },
      },
    })
    expect(calls[0]).toMatchObject({
      vars: { body: { fingerprints: { award_tables: 'fp-award_tables-v4' } } },
    })
  })

  it('does not pre-tick a section that has errors', async () => {
    const base = rulesDraft()
    server = [
      {
        ...base,
        sections: base.sections.map((s) =>
          s.section === 'award_tables' ? { ...s, errors: 1 } : s
        ),
      },
    ]
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const box = await screen.findByRole('checkbox', { name: /Round 1 award table/ })
    expect(box).not.toBeChecked()
    expect(box).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve 0 Sections' })).toBeDisabled()
  })

  it('says what follows when the approval now prices the season', async () => {
    // The refreshed draft: v4 is now the version pricing the season.
    server = [rulesDraft(), rulesDraft(), { ...rulesDraft(), approved_version: 4 }]
    await fillApproval()
    const notice = await screen.findByTestId('rules-notice')
    expect(notice).toHaveTextContent(
      'Approved. Requests not yet posted are priced on the new rules; a posted amount stands.'
    )
    expect(notice).not.toHaveTextContent(/would change by/)
    expect(notice).not.toHaveTextContent(/Nothing is re-priced/)
  })

  it('says nothing is re-priced when sections that price the season still wait', async () => {
    // The refreshed draft still reads against the approved v3.
    server = [rulesDraft(), rulesDraft(), { ...rulesDraft(), approved_version: 3 }]
    await fillApproval()
    const notice = await screen.findByTestId('rules-notice')
    expect(notice).toHaveTextContent(
      'Approved. Nothing is re-priced until every section that prices the season is approved. A posted amount stands.'
    )
    expect(notice).not.toHaveTextContent(/Requests not yet posted/)
    expect(notice).not.toHaveTextContent(/would change by/)
  })

  it('carries the approval report warnings into the notice', async () => {
    outcome = {
      kind: 'ok',
      value: {
        report: {
          issues: [
            {
              section: 'budget',
              code: 'x',
              severity: 'warning',
              path: 'budget.total',
              message: 'The budget is below last season',
            },
            {
              section: 'budget',
              code: 'y',
              severity: 'info',
              path: 'budget.total',
              message: 'An aside nobody needs',
            },
          ],
        },
      },
    }
    await fillApproval()
    const notice = await screen.findByTestId('rules-notice')
    expect(notice).toHaveTextContent(/The budget is below last season/)
    expect(notice).not.toHaveTextContent(/An aside nobody needs/)
  })

  it('puts each approval warning on its own line in the notice', async () => {
    const issue = (message: string) => ({
      section: 'budget',
      code: 'x',
      severity: 'warning',
      path: 'budget.total',
      message,
    })
    outcome = {
      kind: 'ok',
      value: { report: { issues: [issue('First warning.'), issue('Second warning.')] } },
    }
    await fillApproval()
    const notice = await screen.findByTestId('rules-notice')
    expect(notice.textContent).toContain('First warning.\nSecond warning.')
    expect(notice.className).toContain('whitespace-pre-line')
  })

  it('sends nothing when a ticked section moved since the form opened, and unticks and names it', async () => {
    server = [rulesDraft(), movedTableDraft()]
    await fillApproval()
    expect(await screen.findByTestId('approve-conflict')).toHaveTextContent(
      'Changed since you looked, so unchecked: Round 1 award table.'
    )
    expect(calls).toHaveLength(0)
    expect(screen.getByRole('checkbox', { name: 'Round 1 award table' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Approve 0 Sections' })).toBeDisabled()
  })

  it("on the server's 409 reads the draft again, and unticks what moved, so nothing is approved unseen", async () => {
    outcome = { kind: 'refused', status: 409, message: CONFLICT }
    server = [rulesDraft(), rulesDraft(), { ...movedTableDraft(), version: 5 }]
    await fillApproval()
    const conflict = await screen.findByTestId('approve-conflict')
    expect(conflict).toHaveTextContent(CONFLICT)
    expect(conflict).toHaveTextContent('The rules draft is v5 now.')
    expect(conflict).toHaveTextContent(
      'Changed since you looked, so unchecked: Round 1 award table.'
    )
    expect(calls).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'Round 1 award table' })).not.toBeChecked()
  })

  it("on the server's 409 with nothing it checked moved, says so in staff words", async () => {
    outcome = { kind: 'refused', status: 409, message: CONFLICT }
    server = [rulesDraft(), rulesDraft(), { ...rulesDraft(), version: 5 }]
    await fillApproval()
    const conflict = await screen.findByTestId('approve-conflict')
    expect(conflict).toHaveTextContent('The sections you checked read as they did.')
    expect(conflict).not.toHaveTextContent(/tick/i)
  })

  it("keeps the form when the check before sending can't read the draft", async () => {
    server = [rulesDraft(), new Error('Network down'), rulesDraft()]
    await fillApproval()
    expect(
      await screen.findByText(
        "Couldn't check the rules draft is unchanged: Network down. Nothing was approved."
      )
    ).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Approve 1 Section' }))
    await waitFor(() => expect(calls).toHaveLength(1))
  })
})

describe('starting a season (§7.5)', () => {
  it("starts an empty season from last season's rules, saying what wasn't carried", async () => {
    draft = {
      data: undefined,
      isLoading: false,
      error: new AidWriteError('No rules for 2027', 404),
    }
    outcome = {
      kind: 'ok',
      value: {
        ...rulesDraft(),
        report: {
          issues: [
            {
              section: 'cost',
              code: 'prices_cleared_for_new_season',
              severity: 'warning',
              path: 'cost.tuition',
              message:
                "Tuition and family-camp rates were not carried from 2026: session ids are reused across years, so enter 2027's prices",
            },
          ],
        },
      },
    }
    renderAt('/aid/season/rules')
    expect(screen.getByText('No rules for 2027 yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: "Start 2027 from 2026's Rules" }))
    expect(calls[0]?.hook).toBe('start')
    expect(screen.getByTestId('rules-notice')).toHaveTextContent(
      /every section is a draft until approved/
    )
    expect(screen.getByTestId('rules-notice')).toHaveTextContent(/enter 2027's prices/)
  })

  it('shows the server refusal when the season already has rules', async () => {
    draft = { data: undefined, isLoading: false, error: new AidWriteError('No rules', 404) }
    outcome = { kind: 'refused', status: 409, message: 'The season already has rules' }
    renderAt('/aid/season/rules')
    await userEvent.click(screen.getByRole('button', { name: "Start 2027 from 2026's Rules" }))
    expect(await screen.findByText('The season already has rules')).toBeInTheDocument()
  })
})

/** The draft with the Round 1 award table and Budget both waiting for approval. */
function twoDraftsDraft(): ApiAidRulesDraft {
  const base = rulesDraft()
  const award = base.sections.find((x) => x.section === 'award_tables')
  return {
    ...base,
    sections: base.sections.map((x) =>
      x.section === 'budget' && award ? { ...x, status: award.status, errors: 0, warnings: 0 } : x
    ),
  }
}

function gate() {
  let release: (value: ApiAidRulesDraft) => void = () => undefined
  const promise = new Promise<ApiAidRulesDraft>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('the approval form is busy until it is done (review I1)', () => {
  async function openAndApprove(view = renderAt) {
    const rendered = view('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    await within(form).findByRole('checkbox', { name: 'Round 1 award table' })
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 Section' }))
    return rendered
  }

  it('holds Cancel and Approve through the check read before sending', async () => {
    const held = gate()
    server = [rulesDraft(), held.promise]
    await openAndApprove()
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Round 1 award table' })).toBeDisabled()
    expect(calls).toHaveLength(0)
    held.release(rulesDraft())
    await waitFor(() => expect(calls).toHaveLength(1))
  })

  it('sends nothing when the form is gone by the time the check read lands', async () => {
    const held = gate()
    server = [rulesDraft(), held.promise]
    const view = await openAndApprove()
    view.unmount()
    held.release(rulesDraft())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toHaveLength(0)
  })

  it('stays busy through the read after a success', async () => {
    const held = gate()
    server = [rulesDraft(), rulesDraft(), held.promise]
    await openAndApprove()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    held.release({ ...rulesDraft(), approved_version: 4 })
    expect(await screen.findByTestId('rules-notice')).toBeInTheDocument()
  })

  it('stays busy through the re-read after a 409', async () => {
    const held = gate()
    outcome = { kind: 'refused', status: 409, message: CONFLICT }
    server = [rulesDraft(), rulesDraft(), held.promise]
    await openAndApprove()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    held.release({ ...movedTableDraft(), version: 5 })
    expect(await screen.findByTestId('approve-conflict')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('shows Approving… and holds Cancel while the write is in flight', async () => {
    pending = true
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await screen.findByRole('checkbox', { name: 'Round 1 award table' })
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('shows Saving… and holds Cancel while the save is in flight', async () => {
    pending = true
    renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    await screen.findByRole('textbox', { name: 'Minimum award' })
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})

describe('the approval form keeps its own ticks (review I2, m3)', () => {
  it('keeps the ticks when another chapter is jumped to', async () => {
    server = [twoDraftsDraft()]
    draft = { data: twoDraftsDraft(), isLoading: false, error: null }
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Budget and pools' }))
    expect(screen.getByRole('button', { name: 'Approve 2 Sections' })).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByTestId('chapter-bar')).getByRole('button', { name: /^Programs/ })
    )
    expect(screen.getByRole('button', { name: 'Approve 2 Sections' })).toBeInTheDocument()
  })

  it('unticks a ticked section that gained errors since it was seen, and says so', async () => {
    const withErrors = twoDraftsDraft()
    server = [
      twoDraftsDraft(),
      {
        ...withErrors,
        sections: withErrors.sections.map((x) =>
          x.section === 'budget' ? { ...x, errors: 1 } : x
        ),
      },
    ]
    draft = { data: twoDraftsDraft(), isLoading: false, error: null }
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    await userEvent.click(await within(form).findByRole('checkbox', { name: /Budget and pools/ }))
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 2 Sections' }))
    expect(await screen.findByTestId('approve-conflict')).toHaveTextContent(
      'Budget and pools now has errors and was unchecked.'
    )
    expect(calls).toHaveLength(0)
    expect(screen.getByRole('checkbox', { name: /Budget and pools/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Approve 1 Section' })).toBeInTheDocument()
  })

  it('limits the note to what the server takes', async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    await within(form).findByRole('checkbox', { name: 'Round 1 award table' })
    expect(within(form).getByRole('textbox')).toHaveAttribute('maxlength', '2000')
  })
})

describe('the approval notice follows what moved (S8-⚠1 interim, review ⚠1)', () => {
  it('says nothing is re-priced when the draft already priced the season and only the dates are approved', async () => {
    const base = rulesDraft()
    const pricing = {
      ...base,
      approved_version: 4,
      sections: base.sections.map((x) =>
        x.section === 'milestones' ? { ...x, status: { state: 'draft' as const } } : x
      ),
    }
    draft = { data: pricing, isLoading: false, error: null }
    server = [pricing]
    renderAt('/aid/season/rules?section=milestones')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    await within(form).findByRole('checkbox', { name: 'Dates' })
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 Section' }))
    const notice = await screen.findByTestId('rules-notice')
    expect(notice).toHaveTextContent(
      'Approved. The sections that price the season were already approved: nothing is re-priced.'
    )
    expect(notice).not.toHaveTextContent(/Requests not yet posted/)
  })
})

describe('the tab holds still while editing or approving (review m1, m2)', () => {
  it('makes the version in effect inert while editing, with the same cue', async () => {
    renderAt('/aid/season/rules?section=awards')
    expect(screen.getByRole('link', { name: 'v3 in effect' })).toBeInTheDocument()
    await editCard('awards')
    expect(screen.queryByRole('link', { name: 'v3 in effect' })).toBeNull()
    expect(screen.getAllByText('Save or cancel the edit first.')).toHaveLength(1)
  })

  it('makes it inert while approving too, and live again after Cancel', async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await screen.findByRole('checkbox', { name: 'Round 1 award table' })
    expect(screen.queryByRole('link', { name: 'v3 in effect' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('link', { name: 'v3 in effect' })).toBeInTheDocument()
  })
})

describe('the other ways out of busy (round 2, m2)', () => {
  async function approveOnce() {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    await within(form).findByRole('checkbox', { name: 'Round 1 award table' })
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 Section' }))
  }

  it("shows a refusal that isn't a 409 in the server's words, and the form is live again", async () => {
    outcome = { kind: 'refused', status: 422, message: 'A section has errors' }
    await approveOnce()
    expect(await screen.findByText('A section has errors')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Approve 1 Section' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it("lets go when a 409's re-read fails too", async () => {
    outcome = { kind: 'refused', status: 409, message: CONFLICT }
    server = [rulesDraft(), rulesDraft(), new Error('offline')]
    await approveOnce()
    expect(await screen.findByText(/couldn't be read again: offline/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Approve 1 Section' })).toBeEnabled()
  })

  it('lets go when the approval body cannot be built (a section without a fingerprint)', async () => {
    const base = rulesDraft()
    const bare = {
      ...base,
      sections: base.sections.map((x) =>
        x.section === 'award_tables' ? { ...x, fingerprint: '' } : x
      ),
    }
    server = [bare]
    await approveOnce()
    expect(
      await screen.findByText("Couldn't send this approval: reload the rules and try again.")
    ).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })
})

describe('the notice reads the pre-send draft, not the opening one (round 2, m3)', () => {
  it('says the pricing sections were already approved when the check read already had the version', async () => {
    // Opened on approved v3; by the check read v4 is the pricing version (someone else's approval).
    server = [
      rulesDraft(),
      { ...rulesDraft(), approved_version: 4 },
      { ...rulesDraft(), approved_version: 4 },
    ]
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    await within(form).findByRole('checkbox', { name: 'Round 1 award table' })
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 Section' }))
    expect(await screen.findByTestId('rules-notice')).toHaveTextContent(
      'Approved. The sections that price the season were already approved: nothing is re-priced.'
    )
  })
})

describe('a year change resets the editor (round 2, m1, m3c)', () => {
  const tree = () => (
    <MemoryRouter initialEntries={['/aid/season/rules?section=awards']}>
      <Page />
    </MemoryRouter>
  )

  it('drops what was typed when the season changes', async () => {
    const view = renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    const box = await screen.findByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    year = 2028
    view.rerender(tree())
    expect(await screen.findByRole('textbox', { name: 'Minimum award' })).toHaveValue('100')
  })

  it('leaves no dead pills and no editor behind when the new season has no rules', async () => {
    const view = renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    await screen.findByRole('textbox', { name: 'Minimum award' })
    year = 2028
    draft = { data: undefined, isLoading: false, error: new AidWriteError('No rules', 404) }
    view.rerender(tree())
    expect(await screen.findByText('No rules for 2028 yet.')).toBeInTheDocument()
    // The lead line has nothing to switch to, and no cue is left behind.
    expect(within(screen.getByTestId('lead-switch')).queryByRole('link')).toBeNull()
    expect(screen.queryByText('Save or cancel the edit first.')).toBeNull()
    // Starting the season brings the draft back: the editor must not open unasked.
    await userEvent.click(screen.getByRole('button', { name: "Start 2028 from 2027's Rules" }))
    draft = { data: rulesDraft(), isLoading: false, error: null }
    view.rerender(tree())
    expect((await screen.findAllByRole('button', { name: 'Edit…' })).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Editing /)).toBeNull()
  })
})

describe('round 3: what belongs to a season stays with it', () => {
  const treeAt = (path: string) => (
    <MemoryRouter initialEntries={[path]}>
      <Page />
    </MemoryRouter>
  )

  it("says so when a save can't be built (a section without a fingerprint), instead of throwing", async () => {
    const base = rulesDraft()
    server = [
      {
        ...base,
        sections: base.sections.map((x) =>
          x.section === 'awards' ? { ...x, fingerprint: '' } : x
        ),
      },
    ]
    renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    const box = await screen.findByRole('textbox', { name: 'Minimum award' })
    await userEvent.clear(box)
    await userEvent.type(box, '150')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText("Couldn't send this save: reload the rules and try again.")
    ).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it("doesn't carry a start error into another season", async () => {
    draft = { data: undefined, isLoading: false, error: new AidWriteError('No rules', 404) }
    outcome = { kind: 'refused', status: 409, message: 'The season already has rules' }
    const view = renderAt('/aid/season/rules')
    await userEvent.click(screen.getByRole('button', { name: "Start 2027 from 2026's Rules" }))
    expect(await screen.findByText('The season already has rules')).toBeInTheDocument()
    year = 2028
    view.rerender(treeAt('/aid/season/rules'))
    expect(await screen.findByText('No rules for 2028 yet.')).toBeInTheDocument()
    expect(screen.queryByText('The season already has rules')).toBeNull()
  })

  it('drops the notice when the season changes', async () => {
    const view = renderAt('/aid/season/rules?section=awards')
    await editCard('awards')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Minimum award' }), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByTestId('rules-notice')).toBeInTheDocument()
    year = 2028
    view.rerender(treeAt('/aid/season/rules?section=awards'))
    expect(screen.queryByTestId('rules-notice')).toBeNull()
  })

  it("words the pills' cue for the mode: edit or approve", async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await screen.findByRole('checkbox', { name: 'Round 1 award table' })
    expect(screen.getByText('Approve or cancel first.')).toBeInTheDocument()
    expect(screen.queryByText('Save or cancel the edit first.')).toBeNull()
  })
})

describe('editing a card in place (spec §6.2 F; Task 48)', () => {
  // The plan's `renderRules`, `saveSpy` and `FINANCE` are this file's `renderAt`, `calls` and the all-true
  // permissions mock above; its saved body is `calls.at(-1).vars.body`.
  const savedContent = () =>
    (calls.at(-1)?.vars as { body: { content: Record<string, Record<string, unknown>> } }).body
      .content

  it('edits a card in place and saves the programs with table_from_equity_class and no r1_table', async () => {
    renderAt('/aid/season/rules?open=5')
    await userEvent.click(
      within(screen.getByTestId('card-head-programs')).getByRole('button', { name: 'Edit…' })
    )
    expect(
      await screen.findByText(/^Editing Programs and their sessions in the rules draft \(v\d+\)$/)
    ).toBeInTheDocument()
    await userEvent.selectOptions(
      screen.getAllByRole('combobox', { name: /Budget pool/ })[0]!,
      'pool_b'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const content = savedContent()
    expect(content['summer']?.['budget_pool']).toBe('pool_b')
    expect(
      Object.values(content).every(
        (p) => p['table_from_equity_class'] === true && !('r1_table' in p)
      )
    ).toBe(true)
  })

  it('shows the Costs boxes in whole dollars, as stored, and an untouched editor has nothing to save (B7)', async () => {
    const base = rulesDraft()
    const cost = {
      ...RULES_DOCUMENT.cost,
      tuition: { '1000101': '6695.0', '1000102': '6695.50' },
    }
    const withCost = { ...base, document: { ...base.document, cost } }
    draft = { data: withCost, isLoading: false, error: null }
    server = [withCost]
    renderAt('/aid/season/rules?open=5')
    await editCard('cost')
    const boxes = (await screen.findAllByRole('textbox')).filter((box) =>
      (box.getAttribute('aria-label') ?? '').includes('Tuition')
    )
    expect(boxes.map((box) => (box as HTMLInputElement).value)).toEqual(['6,695', '6,695.50'])
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.clear(boxes[0]!)
    await userEvent.type(boxes[0]!, '7,100')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(savedContent()['tuition']).toEqual({ '1000101': '7100', '1000102': '6695.50' })
  })

  it('greys a criterion row live when Enabled is unchecked, and keeps its weights', async () => {
    const base = rulesDraft()
    const equity = {
      criteria: [
        {
          key: 'need',
          label: 'Need',
          enabled: true,
          source: 'household' as const,
          field: 'need',
          match: 'equals_any' as const,
          values: ['yes'],
        },
      ],
      weights: { camp: { need: '0.5' } },
      aggregation: 'ceil' as const,
      max_shift: null,
    }
    const withEquity = { ...base, document: { ...base.document, equity } }
    draft = { data: withEquity, isLoading: false, error: null }
    server = [withEquity]
    renderAt('/aid/season/rules?open=1')
    await userEvent.click(
      within(screen.getByTestId('card-head-equity')).getByRole('button', { name: 'Edit…' })
    )
    // Plan-test fix: rulesModel names the key `enabled` "On" (as the Checks table does), so the box is
    // "Criteria › 1 › On", not ".. Enabled"; the column head says Enabled.
    const enabled = (await screen.findAllByRole('checkbox', { name: /^Criteria › 1 › On$/ }))[0]!
    await userEvent.click(enabled)
    expect(enabled.closest('tr')).toHaveClass('opacity-50')
    expect(within(enabled.closest('tr')!).getAllByRole('textbox').length).toBeGreaterThan(0)
    expect(screen.getByText('was checked')).toBeInTheDocument()
  })

  it('disables every Edit… while the Approve panel is open', async () => {
    renderAt('/aid/season/rules?open=1')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(screen.queryByRole('button', { name: 'Edit…' })).toBeNull()
    expect(screen.getByText('Approve or cancel first.')).toBeInTheDocument()
  })

  // Slice 2: Approve… showed only when nothing was being edited, so it could never approve the old copy of an open
  // card's typing. The tab tells the chrome while any card editor (the tiers editor included) is open.
  it.each(['programs', 'tiers'])(
    'hides Approve… while the %s editor is open and brings it back on Cancel',
    async (section) => {
      renderAt(`/aid/season/rules?open=1,5&section=${section}`)
      expect(await screen.findByRole('button', { name: 'Approve…' })).toBeInTheDocument()
      await editCard(section)
      expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('button', { name: 'Approve…' })).toBeInTheDocument()
    }
  )
})

describe('the tiers editor and the grid editors in the tier grid card (spec §6.2 E.2; Task 49)', () => {
  const saved = () => calls.at(-1)?.vars as { section: string; body: { content: unknown } }
  const tierRow = (tier: number) =>
    screen.getByTestId('tier-grid').querySelector<HTMLElement>(`tr[data-tier="${String(tier)}"]`)!

  // The fixture's three bands are uneven (a by-hand set); the tiers editor opens on even ones, so these use $40,000 bands.
  beforeEach(() => {
    const base = rulesDraft()
    const even = {
      ...base,
      document: {
        ...base.document,
        tiers: {
          bands: [
            { lower: '0', upper: '40000' },
            { lower: '40001', upper: '80000' },
            { lower: '80001', upper: null },
          ],
          income_ceiling: null,
          floor_tier: 1,
        },
      },
    }
    draft = { data: even, isLoading: false, error: null }
    server = [even]
  })

  it('opens the tiers editor in the grid card and rebuilds the grid live: new tiers read "—"', async () => {
    renderAt('/aid/season/rules?section=tiers')
    await editCard('tiers')
    const tiers = await screen.findByLabelText('Tiers')
    expect(screen.getByTestId('grid-editor-tiers')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.clear(tiers)
    await userEvent.type(tiers, '4')
    expect(screen.getByText('was 3')).toBeInTheDocument()
    // The grid below follows the typed bands: tier 4 starts at 120001 and has no figures yet.
    const row = tierRow(4)
    expect(row).toHaveTextContent('$120,001 and up')
    expect(row).toHaveTextContent('—')
  })

  it('saves what the tiers editor reports: the bands and the income ceiling', async () => {
    renderAt('/aid/season/rules?section=tiers')
    await editCard('tiers')
    const tiers = await screen.findByLabelText('Tiers')
    await userEvent.clear(tiers)
    await userEvent.type(tiers, '4')
    await userEvent.type(screen.getByLabelText('Income ceiling'), '250000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(saved().section).toBe('tiers')
    expect(saved().body.content).toEqual({
      bands: [
        { lower: '0', upper: '40000' },
        { lower: '40001', upper: '80000' },
        { lower: '80001', upper: '120000' },
        { lower: '120001', upper: null },
      ],
      income_ceiling: '250000',
      floor_tier: 1,
    })
  })

  it('holds Save while a tiers box is not a figure', async () => {
    renderAt('/aid/season/rules?section=tiers')
    await editCard('tiers')
    const width = await screen.findByLabelText('Band width')
    await userEvent.clear(width)
    await userEvent.type(width, 'abc')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // Coordinator B1: the editor grids keep the saved draft's ⚠ marks, captioned as last saved (not the typing).
  it.each(['award_tables', 'round2', 'tiers'])(
    'the %s editor keeps the Round 1 cell ⚠ marks, captioned "as last saved"',
    async (section) => {
      const base = draft.data!
      const warned = {
        ...base,
        report: {
          issues: [
            ...(base.report.issues ?? []),
            {
              section: 'award_tables' as const,
              code: 'value_cannot_bind',
              severity: 'warning' as const,
              path: 'award_tables.general.tiers.2',
              message: 'Tier 2 of the general table: the minimum decides every award here',
            },
          ],
        },
      }
      draft = { data: warned, isLoading: false, error: null }
      server = [warned]
      renderAt(`/aid/season/rules?section=${section}`)
      await editCard(section)
      await screen.findByTestId('tier-grid')
      expect(
        within(tierRow(2)).getByRole('button', { name: "Show this table's warnings" })
      ).toBeInTheDocument()
      expect(
        within(tierRow(1)).queryByRole('button', { name: "Show this table's warnings" })
      ).toBeNull()
      expect(
        within(screen.getByTestId(`grid-editor-${section}`)).getByText(
          '⚠ marks the warnings as last saved, not what you have typed.'
        )
      ).toBeInTheDocument()
      // Coordinator B2: the ⚠ opens the chip's one list, filtered to its table, while editing too.
      await userEvent.click(
        within(tierRow(2)).getByRole('button', { name: "Show this table's warnings" })
      )
      expect(screen.getAllByTestId('card-issue').map((li) => li.textContent)).toEqual([
        'Tier 2 of the general table: the minimum decides every award here',
      ])
    }
  )

  // B3: the editor grids keep the "min" marks too, captioned as last saved.
  it.each(['award_tables', 'round2', 'tiers'])(
    'the %s editor keeps the "min" marks, captioned "as last saved", and footnotes a click',
    async (section) => {
      const base = draft.data!
      const message =
        'general table, tier 3: Program A at $600 gets $52.50, so the $75 minimum applies'
      const noted = {
        ...base,
        report: {
          issues: [
            ...(base.report.issues ?? []),
            {
              section: 'award_tables' as const,
              code: 'value_cannot_bind',
              severity: 'note' as const,
              path: 'award_tables.general.tiers.3',
              message,
            },
          ],
        },
      }
      draft = { data: noted, isLoading: false, error: null }
      server = [noted]
      renderAt(`/aid/season/rules?section=${section}`)
      await editCard(section)
      await screen.findByTestId('tier-grid')
      const mark = within(tierRow(3)).getByRole('button', { name: 'min' })
      expect(mark).toHaveAttribute('title', message)
      expect(screen.queryByRole('button', { name: "Show this table's warnings" })).toBeNull()
      expect(
        within(screen.getByTestId(`grid-editor-${section}`)).getByText(
          'min marks where the minimum decides, as last saved, not what you have typed.'
        )
      ).toBeInTheDocument()
      await userEvent.click(mark)
      expect(screen.getAllByText(message)).toHaveLength(1)
    }
  )

  it('Round 1 award table editor puts a box in each own cell of the grid, and leaves an inherited cell as text', async () => {
    const base = rulesDraft()
    const withInheriting = {
      ...base,
      document: {
        ...base.document,
        award_tables: {
          ...base.document.award_tables,
          special: { inherits: 'general', tiers: {}, overrides: { '2': { r1_pct: '70' } } },
        },
      },
    }
    draft = { data: withInheriting, isLoading: false, error: null }
    server = [withInheriting]
    renderAt('/aid/season/rules?section=award_tables')
    await editCard('award_tables')
    await screen.findByTestId('tier-grid')
    const tier2 = tierRow(2)
    expect(within(tier2).getAllByRole('textbox')).toHaveLength(2)
    const tier1 = tierRow(1)
    // Tier 1: general's own box, and special's inherited 90% as plain words.
    expect(within(tier1).getAllByRole('textbox')).toHaveLength(1)
    expect(tier1).toHaveTextContent('90%')
    const box = within(tier2).getAllByRole('textbox')[0]!
    await userEvent.clear(box)
    await userEvent.type(box, '50')
    expect(screen.getByText('was 55%')).toBeInTheDocument()
  })

  it('Appeal caps editor boxes the appeal cells of the grid and saves the round 2 section', async () => {
    renderAt('/aid/season/rules?section=round2')
    await editCard('round2')
    await screen.findByTestId('tier-grid')
    const tier1 = tierRow(1)
    // Round 1 cell stays text here; the one appeal cell with a figure is the box.
    expect(within(tier1).getAllByRole('textbox')).toHaveLength(1)
    const box = within(tier1).getByRole('textbox')
    await userEvent.clear(box)
    await userEvent.type(box, '97')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(saved().section).toBe('round2')
    expect(saved().body.content).toMatchObject({
      tables: { general: { tiers: { '1': { total_pct: '97' } } } },
    })
  })
})
