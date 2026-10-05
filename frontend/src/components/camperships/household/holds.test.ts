import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { fixLink, fixWords, UNRELEASABLE_CODES } from './holds'

// The shared contract: the pytest holds the server's UNRELEASABLE to it (I5).
const MIRRORS = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../tests/fixtures/camperships_frontend_mirrors.json'),
    'utf-8'
  )
) as { unreleasable: string[] }

describe('holds (main spec §10.5; Decision 25)', () => {
  it("offers no release for a hold the server won't release (UNRELEASABLE, through the shared fixture)", () => {
    expect([...UNRELEASABLE_CODES].sort()).toEqual([...MIRRORS.unreleasable].sort())
  })

  it('points a hold that clears by fixing its cause at the fix', () => {
    expect(fixLink('household_income_conflict', 'reqliam00000002')).toEqual({
      label: 'Enter the Income ↓',
      href: '#income',
    })
    expect(fixLink('payer_shares_incomplete', 'reqliam00000002')).toEqual({
      label: 'Set the Shares ↓',
      href: '#request-reqliam00000002',
    })
    expect(fixLink('py_confirm_tier_change', 'reqliam00000002')).toBeNull()
  })

  // B26 (ruled 10-04 late): an above-cost hold names its three fixes; the amount is the card's editor.
  it('points an above-cost hold at the award on its card, and names the three fixes', () => {
    expect(fixLink('award_above_cost', 'reqliam00000002')).toEqual({
      label: 'Edit the Award ↓',
      href: '#request-reqliam00000002',
    })
    expect(fixWords('award_above_cost')).toBe('Three fixes: the cost, the grants, or the amount.')
    expect(fixWords('household_income_conflict')).toBeNull()
  })
})
