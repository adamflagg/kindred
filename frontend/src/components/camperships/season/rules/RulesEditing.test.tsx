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
import { savePrecondition } from './precondition'
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
vi.mock('../../../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: () => undefined,
}))
// PR 7's capacity form has its own tests (CapacityForm.test.tsx).
vi.mock('./CapacityForm', () => ({ CapacityForm: () => <div>Session capacity form</div> }))

type Outcome = { kind: 'ok'; value: unknown } | { kind: 'refused'; status: number; message: string }
let outcome: Outcome
const calls: Array<{ hook: string; vars: unknown }> = []
interface Handlers {
  onSuccess?: (value: unknown) => void
  onError?: (error: Error) => void
}
function fakeWrite(hook: string) {
  return {
    isPending: false,
    mutate: (vars: unknown, handlers?: Handlers) => {
      calls.push({ hook, vars })
      if (outcome.kind === 'ok') handlers?.onSuccess?.(outcome.value)
      else handlers?.onError?.(new AidWriteError(outcome.message, outcome.status))
    },
  }
}
let server: Array<ApiAidRulesDraft | Error>
function freshRead(): Promise<ApiAidRulesDraft> {
  const next = server.length > 1 ? server.shift() : server[0]
  if (next === undefined) return Promise.resolve(rulesDraft())
  return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
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

beforeEach(() => {
  draft = { data: rulesDraft(), isLoading: false, error: null }
  outcome = { kind: 'ok', value: rulesDraft() }
  server = [rulesDraft()]
  calls.length = 0
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
    expect(await screen.findByText(/Locked: a posted round read it/)).toBeInTheDocument()
  })

  it('holds the section list still while editing', async () => {
    renderAt('/aid/season/rules?section=awards')
    await userEvent.click(screen.getByRole('button', { name: 'Edit…' }))
    expect(screen.getByText('Save or cancel the edit first.')).toBeInTheDocument()
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
