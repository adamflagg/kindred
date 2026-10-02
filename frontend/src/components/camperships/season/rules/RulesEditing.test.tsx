/**
 * Editing the rules (spec §7.5; D39) and the answer when someone else changed the
 * section (Decisions 16–17), on screen. The reads are mocked with rulesFixtures' invented 2027 rules.
 * `server` is the queue of drafts the fresh reads return (open, the check before sending, the re-read
 * after a 409), the last one repeating; an Error in it is a failed read. Each test sets how the next
 * write answers.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidWriteError } from '../../../../services/camperships/aidApi'
import type { ApiAidRulesDraft } from '../../../../types/api-types'
import { approvePrecondition, savePrecondition } from './precondition'
import { RULES_DOCUMENT, rulesDraft } from './rulesFixtures'
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
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
// PR 7's capacity form has its own tests (CapacityForm.test.tsx).
vi.mock('./CapacityForm', () => ({ CapacityForm: () => <div>Session capacity form</div> }))

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

const CONFLICT = 'Someone else changed this; reload and try again'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RulesTab />
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
})

describe('editing a section (D39; Decisions 14–16)', () => {
  it('says which draft it edits, and saves the section with the version it opened', async () => {
    renderAt('/aid/season/rules?section=awards')
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
    expect(
      await screen.findByText('Editing Minimum award and limits in the rules draft (v4)')
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

  it('says a save landed in a new version when it would have changed approved rules in use', async () => {
    outcome = { kind: 'ok', value: { ...rulesDraft(), version: 5, branched_from: 4 } }
    renderAt('/aid/season/rules?section=awards')
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Minimum award' }), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByTestId('rules-notice')).toHaveTextContent(
      'Saved as a new version, v5: the approved rules in use stay as they are until it is approved.'
    )
  })

  it("won't send a box it can't read, and says why in the box's own words", async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
    const editor = await screen.findByTestId('section-editor')
    expect(within(editor).queryByRole('textbox')).toBeNull()
    expect(within(editor).getAllByRole('combobox').length).toBeGreaterThan(0)
    expect(within(editor).getByText('1000101, 1000102')).toBeInTheDocument()
  })

  it('says a locked section saves into a new version and posted amounts stand', async () => {
    renderAt('/aid/season/rules?section=income')
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
    expect(
      await screen.findByText(
        'Locked: a posted round read it. Saving may start a new version of it. Posted amounts stand.'
      )
    ).toBeInTheDocument()
  })

  it('holds the section list still while editing', async () => {
    renderAt('/aid/season/rules?section=awards')
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
    // The list's cue, and the tab's own pills' (review m2).
    expect(screen.getAllByText('Save or cancel the edit first.')).toHaveLength(2)
    const other = document.querySelector('[data-rules-section="budget"]')
    expect(other?.tagName).toBe('DIV')
  })
})

describe('someone else changed the section (Decision 16; owner ruling 2026-10-02)', () => {
  async function typeMinimum(value: string) {
    renderAt('/aid/season/rules?section=awards')
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
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

    await userEvent.click(screen.getByRole('button', { name: 'Put my edit on v5' }))
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
    await userEvent.click(within(conflict).getByRole('button', { name: 'Try again' }))
    expect(await within(conflict).findByText('Minimum award: $100 → $120')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Put my edit on v5' })).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
    const box = await screen.findByLabelText('Income bands › 2 › To')
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
    expect(
      await within(form).findByRole('checkbox', { name: 'Award tables (Round 1 %)' })
    ).toBeChecked()
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 section' }))
  }

  it('approves the ticked draft sections with the note naming the body', async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    expect(
      await within(form).findByRole('checkbox', { name: 'Award tables (Round 1 %)' })
    ).toBeChecked()
    expect(within(form).getByRole('button', { name: 'Approve 1 section' })).toBeDisabled()
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 section' }))
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
    const box = await screen.findByRole('checkbox', { name: /Award tables \(Round 1 %\)/ })
    expect(box).not.toBeChecked()
    expect(box).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve 0 sections' })).toBeDisabled()
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

  it('sends nothing when a ticked section moved since the form opened, and unticks and names it', async () => {
    server = [rulesDraft(), movedTableDraft()]
    await fillApproval()
    expect(await screen.findByTestId('approve-conflict')).toHaveTextContent(
      'Changed since you looked, so unticked: Award tables (Round 1 %).'
    )
    expect(calls).toHaveLength(0)
    expect(screen.getByRole('checkbox', { name: 'Award tables (Round 1 %)' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Approve 0 sections' })).toBeDisabled()
  })

  it("on the server's 409 reads the draft again, and unticks what moved, so nothing is approved unseen", async () => {
    outcome = { kind: 'refused', status: 409, message: CONFLICT }
    server = [rulesDraft(), rulesDraft(), { ...movedTableDraft(), version: 5 }]
    await fillApproval()
    const conflict = await screen.findByTestId('approve-conflict')
    expect(conflict).toHaveTextContent(CONFLICT)
    expect(conflict).toHaveTextContent('The rules draft is v5 now.')
    expect(conflict).toHaveTextContent(
      'Changed since you looked, so unticked: Award tables (Round 1 %).'
    )
    expect(calls).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'Award tables (Round 1 %)' })).not.toBeChecked()
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
    await userEvent.click(screen.getByRole('button', { name: 'Approve 1 section' }))
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
    await userEvent.click(screen.getByRole('button', { name: "Start 2027 from 2026's rules" }))
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
    await userEvent.click(screen.getByRole('button', { name: "Start 2027 from 2026's rules" }))
    expect(await screen.findByText('The season already has rules')).toBeInTheDocument()
  })
})

/** The draft with Award tables and Budget both waiting for approval. */
function twoDraftsDraft(): ApiAidRulesDraft {
  const base = rulesDraft()
  const award = base.sections.find((x) => x.section === 'award_tables')
  return {
    ...base,
    sections: base.sections.map((x) =>
      x.section === 'budget' && award ? { ...x, status: award.status } : x
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
    await within(form).findByRole('checkbox', { name: 'Award tables (Round 1 %)' })
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 section' }))
    return rendered
  }

  it('holds Cancel and Approve through the check read before sending', async () => {
    const held = gate()
    server = [rulesDraft(), held.promise]
    await openAndApprove()
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
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
    await screen.findByRole('checkbox', { name: 'Award tables (Round 1 %)' })
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('shows Saving… and holds Cancel while the save is in flight', async () => {
    pending = true
    renderAt('/aid/season/rules?section=awards')
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
    await screen.findByRole('textbox', { name: 'Minimum award' })
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})

describe('the approval form keeps its own ticks (review I2, m3)', () => {
  it('keeps the ticks when another section is clicked in the list', async () => {
    server = [twoDraftsDraft()]
    draft = { data: twoDraftsDraft(), isLoading: false, error: null }
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Budget and reserves' }))
    expect(screen.getByRole('button', { name: 'Approve 2 sections' })).toBeInTheDocument()
    const other = document.querySelector('[data-rules-section="income"]')
    if (other === null) throw new Error('no income row')
    await userEvent.click(other)
    expect(screen.getByRole('button', { name: 'Approve 2 sections' })).toBeInTheDocument()
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
    await userEvent.click(
      await within(form).findByRole('checkbox', { name: /Budget and reserves/ })
    )
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 2 sections' }))
    expect(await screen.findByTestId('approve-conflict')).toHaveTextContent(
      'Budget and reserves now has errors and was unticked.'
    )
    expect(calls).toHaveLength(0)
    expect(screen.getByRole('checkbox', { name: /Budget and reserves/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Approve 1 section' })).toBeInTheDocument()
  })

  it('limits the note to what the server takes', async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    await within(form).findByRole('checkbox', { name: 'Award tables (Round 1 %)' })
    expect(within(form).getByRole('textbox')).toHaveAttribute('maxlength', '2000')
  })
})

describe('the approval notice follows what moved (S8-⚠1 interim, review ⚠1)', () => {
  it('says nothing is re-priced when the draft already priced the season and only stages are approved', async () => {
    const base = rulesDraft()
    const pricing = {
      ...base,
      approved_version: 4,
      sections: base.sections.map((x) =>
        x.section === 'stages' ? { ...x, status: { state: 'draft' as const } } : x
      ),
    }
    draft = { data: pricing, isLoading: false, error: null }
    server = [pricing]
    renderAt('/aid/season/rules?section=stages')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    const form = screen.getByTestId('approve-form')
    await within(form).findByRole('checkbox', { name: 'Stages' })
    await userEvent.type(within(form).getByRole('textbox'), 'Finance, Jan 22 meeting')
    await userEvent.click(within(form).getByRole('button', { name: 'Approve 1 section' }))
    const notice = await screen.findByTestId('rules-notice')
    expect(notice).toHaveTextContent(
      'Approved. Nothing is re-priced until every section that prices the season is approved. A posted amount stands.'
    )
    expect(notice).not.toHaveTextContent(/Requests not yet posted/)
  })
})

describe('the tab holds still while editing or approving (review m1, m2)', () => {
  it('makes the Approved pill inert while editing, with the same cue', async () => {
    renderAt('/aid/season/rules?section=awards')
    expect(screen.getByRole('link', { name: 'Approved' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
    expect(screen.queryByRole('link', { name: 'Approved' })).toBeNull()
    expect(screen.getAllByText('Save or cancel the edit first.')).toHaveLength(2)
  })

  it('makes it inert while approving too, and live again after Cancel', async () => {
    renderAt('/aid/season/rules?section=award_tables')
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await screen.findByRole('checkbox', { name: 'Award tables (Round 1 %)' })
    expect(screen.queryByRole('link', { name: 'Approved' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('link', { name: 'Approved' })).toBeInTheDocument()
  })
})
