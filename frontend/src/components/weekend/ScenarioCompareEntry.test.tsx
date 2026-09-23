/**
 * The "Compare with CampMinder" entry point (kindred#2478 §5).
 *
 * What is pinned here is WHERE the affordance may appear: the three conditions
 * `PushWriteInsEntry` already carries. A fourth, family camp only (owner ruling
 * §5.1), was lifted on 2026-09-23 once adult guests joined the daily person
 * pass (kindred#2760); the component no longer takes a session type at all.
 *
 * Fictional data throughout.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ScenarioCompareEntry } from './ScenarioCompareEntry'

vi.mock('./ScenarioCompareModal', () => ({
  ScenarioCompareModal: () => null,
}))

interface EntryProps {
  year: number
  sessionCmId: number
  scenario: string
  canManage: boolean
}

const BASE: EntryProps = {
  year: 2026,
  sessionCmId: 1309001,
  scenario: 'scn_1',
  canManage: true,
}

function renderEntry(overrides: Partial<EntryProps> = {}) {
  return render(<ScenarioCompareEntry {...BASE} {...overrides} />)
}

describe('ScenarioCompareEntry', () => {
  it('offers the comparison inside a scenario on a family weekend', () => {
    renderEntry()
    expect(screen.getByRole('button', { name: /compare with campminder/i })).toBeInTheDocument()
  })

  it('renders nothing on the mirror, which cannot be compared against itself', () => {
    renderEntry({ scenario: '' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing for a user without bunking.manage', () => {
    // The endpoint is `bunking.manage`-gated exactly as `/push/preview` is;
    // an affordance with nothing behind it is not a refusal, so it is absent
    // rather than dimmed (the board's `opacity-40` vocabulary is for a
    // refusal, CLAUDE.md §4).
    renderEntry({ canManage: false })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing with no weekend selected', () => {
    renderEntry({ sessionCmId: 0 })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
