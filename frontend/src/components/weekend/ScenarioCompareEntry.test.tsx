/**
 * The "Compare with CampMinder" entry point (kindred#2478 §5).
 *
 * What is pinned here is WHERE the affordance may appear. Three of the four
 * conditions are the ones `PushWriteInsEntry` already carries; the fourth —
 * family camp only — is owner ruling §5.1 and is the one this file exists for.
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
  sessionType: string
}

const BASE: EntryProps = {
  year: 2026,
  sessionCmId: 1309001,
  scenario: 'scn_1',
  canManage: true,
  sessionType: 'family',
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

  it('renders nothing on an adult weekend', () => {
    // Owner ruling §5.1: family camp weekends only. The adult sessions are
    // not in the bounded refresh cohort at all, so their mirror rows are
    // rewritten daily from custom values up to seven days old — a comparison
    // against them would grade a plan against data nobody refreshed.
    renderEntry({ sessionType: 'adult' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
