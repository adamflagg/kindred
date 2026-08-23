/**
 * The write-in push queue's decision deck (kindred#2477 Task 9) — one card
 * at a time for every building the report classed `conflict` or `remove`.
 *
 * `deck(...)` mirrors what `PushWriteInsModal` (Task 8/10) would pass:
 * `buildings` pre-filtered to conflicts+removes, and `pushDisabled` computed
 * the same way the modal computes it — `decisionCount > decidedCount`
 * (D33's ruled block). `deckAt(key)` renders the deck with a SINGLE building
 * so the card under test is the one on screen without navigating there.
 *
 * Fictional data throughout — three building fixtures reused across the four
 * RED tests: `cedar-9` (a pairwise conflict — 1 live row vs 1 draft row),
 * `aspen-5` (a remove — a single live row, no draft), `big-house` (a
 * whole-building set — 2 live room rows vs 1 whole-house draft row).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PushBuildingReport, PushRowPayload } from '../../services/lodgingApi'
import { PushDecisionDeck } from './PushDecisionDeck'
import type { Decision } from './PushWriteInsModal'

function row(
  unitCode: string,
  occupantName: string,
  overrides: Partial<PushRowPayload> = {}
): PushRowPayload {
  return {
    unit_id: `u-${unitCode}`,
    unit_code: unitCode,
    unit_name: unitCode,
    occupant_name: occupantName,
    note: '',
    party_size: null,
    sleeps: null,
    ...overrides,
  }
}

const CEDAR: PushBuildingReport = {
  key: 'cedar-9',
  label: 'Cedar 9',
  cls: 'conflict',
  live: [row('cedar-9', 'G. Whitfield', { sleeps: 4 })],
  draft: [row('cedar-9', 'H. Osei', { sleeps: 4, note: 'Late arrival Friday', party_size: 2 })],
}

const ASPEN: PushBuildingReport = {
  key: 'aspen-5',
  label: 'Aspen 5',
  cls: 'remove',
  live: [row('aspen-5', 'F. Moreau', { sleeps: 3 })],
  draft: [],
}

const BIG_HOUSE: PushBuildingReport = {
  key: 'big-house',
  label: 'Big House',
  cls: 'conflict',
  live: [
    row('big-house-loft', 'R. Okafor', { sleeps: 4 }),
    row('big-house-den', 'A. Delgado', { sleeps: 3 }),
  ],
  draft: [row('big-house', 'Woodson family', { sleeps: 9, party_size: 6 })],
}

const BIRCH: PushBuildingReport = {
  key: 'birch-2',
  label: 'Birch 2',
  cls: 'remove',
  live: [row('birch-2', 'S. Delacroix', { sleeps: 5, party_size: 3 })],
  draft: [],
}

// A remove building CAN carry more than one live row — a multi-room
// building the scenario drops entirely still has every one of its live rows
// removed by `execute_push`, not just the first. RemoveCard must show all of
// them, not just `building.live[0]`.
const WILLOW: PushBuildingReport = {
  key: 'willow-3',
  label: 'Willow 3',
  cls: 'remove',
  live: [
    row('willow-3-loft', 'M. Kowalczyk', { sleeps: 2 }),
    row('willow-3-den', 'T. Abubakar', { sleeps: 3 }),
  ],
  draft: [],
}

const BUILDINGS_BY_KEY: Record<string, PushBuildingReport> = {
  'cedar-9': CEDAR,
  'aspen-5': ASPEN,
  'big-house': BIG_HOUSE,
  'birch-2': BIRCH,
  'willow-3': WILLOW,
}

function decidedCount(
  buildings: readonly PushBuildingReport[],
  decisions: Record<string, Decision>
) {
  return buildings.filter((b) => decisions[b.key] !== undefined).length
}

function deck(
  overrides: {
    buildings?: PushBuildingReport[]
    decisions?: Record<string, Decision>
    onDecide?: (key: string, decision: Decision) => void
    onPush?: () => void
  } = {}
) {
  const buildings = overrides.buildings ?? [CEDAR, ASPEN]
  const decisions = overrides.decisions ?? {}
  return (
    <PushDecisionDeck
      buildings={buildings}
      decisions={decisions}
      onDecide={overrides.onDecide ?? vi.fn()}
      onPush={overrides.onPush ?? vi.fn()}
      pushDisabled={buildings.length > decidedCount(buildings, decisions)}
    />
  )
}

function deckAt(key: string) {
  const building = BUILDINGS_BY_KEY[key]
  if (building === undefined) throw new Error(`no fixture building "${key}"`)
  return deck({ buildings: [building] })
}

describe('PushDecisionDeck', () => {
  it('push stays disabled until every decision is made — the ruled block', () => {
    const { rerender } = render(deck({ decisions: {} }))
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled()
    rerender(deck({ decisions: { 'cedar-9': 'scenario' } })) // 1 of 2
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled()
    rerender(deck({ decisions: { 'cedar-9': 'scenario', 'aspen-5': 'keep' } }))
    expect(screen.getByRole('button', { name: 'Push' })).toBeEnabled()
  })

  it('pairwise conflict picks a side and reports it', async () => {
    const onDecide = vi.fn()
    render(deck({ onDecide }))
    await userEvent.click(screen.getByRole('button', { name: /take scenario|scn_1/i }))
    expect(onDecide).toHaveBeenCalledWith('cedar-9', 'scenario')
  })

  it('whole-building set renders the composed after view', async () => {
    render(deckAt('big-house')) // 2 live room rows vs 1 whole-house draft row
    // previewing "take scenario": live rows struck, draft row marked new
    expect(screen.getByText('R. Okafor').closest('[data-after-state]')).toHaveAttribute(
      'data-after-state',
      'gone'
    )
    expect(screen.getByText('Woodson family').closest('[data-after-state]')).toHaveAttribute(
      'data-after-state',
      'new'
    )
  })

  it('arrow keys move; 1 and 2 decide', async () => {
    const onDecide = vi.fn()
    render(deck({ onDecide }))
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    await userEvent.keyboard('2')
    expect(onDecide).toHaveBeenCalledWith('aspen-5', 'remove')
  })

  // kindred#2477 review finding: the bed line must be SIDE-SCOPED (live and
  // scenario computed independently), never a union of both sides' rows.
  // BIG_HOUSE's draft carries a whole-house container row (sleeps 9) ALONGSIDE
  // two live room rows (sleeps 4 + 3) that name a different unit_id each — a
  // union sums all three to a nonsense 16 beds. Side-scoped: live (loft+den,
  // both wholesale) is 7; scenario (the whole-house row alone) is 9.
  it('the whole-building bed line is side-scoped, not the union of both sides', () => {
    render(deckAt('big-house'))
    expect(
      screen.getByText('Live: wholesale — all 7 beds → Scenario: 6 of 9 beds')
    ).toBeInTheDocument()
  })

  // A pairwise card's live and draft rows name the SAME unit (one room, two
  // proposed occupants) — the per-side bed count must read that unit's own
  // sleeps once, not sum live's 4 and draft's 4 into 8.
  it('a pairwise same-unit card counts the unit once per side, not doubled', () => {
    render(deckAt('cedar-9'))
    expect(
      screen.getByText('Live: wholesale — all 4 beds → Scenario: 2 of 4 beds')
    ).toBeInTheDocument()
  })

  // The wholesale/sized branch, pinned independent of the two-sided cards
  // above: a side with every row's party_size recorded shows the SUMMED
  // party size over capacity, not the literal wholesale text.
  it('a sized side shows the summed party size, not the wholesale text', () => {
    render(deckAt('birch-2'))
    expect(screen.getByText('3 of 5 beds')).toBeInTheDocument()
  })

  // kindred#2477 final review, Critical #2: `execute_push` removes ALL of a
  // remove building's live rows, but RemoveCard rendered only `live[0]` —
  // staff approving the removal never saw the second occupant being dropped.
  it('a remove building with two live rows shows both occupants', () => {
    render(deckAt('willow-3'))
    expect(screen.getByText('M. Kowalczyk')).toBeInTheDocument()
    expect(screen.getByText('T. Abubakar')).toBeInTheDocument()
  })
})
