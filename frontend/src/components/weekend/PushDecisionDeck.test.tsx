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

const BUILDINGS_BY_KEY: Record<string, PushBuildingReport> = {
  'cedar-9': CEDAR,
  'aspen-5': ASPEN,
  'big-house': BIG_HOUSE,
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
})
