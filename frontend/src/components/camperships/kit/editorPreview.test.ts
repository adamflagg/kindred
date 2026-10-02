import { describe, expect, it } from 'vitest'

import type { ApiAidPreview } from '../../../types/api-types'
import { toEditorPreview } from './editorPreview'

const OUT: ApiAidPreview = {
  award: 780,
  trace: [
    {
      key: 'r2',
      label: 'Round 2 award',
      value: '780',
      inputs: {},
      bound: null,
      note: null,
      section: null,
    },
  ],
  stage_after: 'needs_offer',
  stage_after_label: 'Needs an offer',
  shares: [
    { household_cm_id: 1000001, pct: 60, amount: 468 },
    { household_cm_id: 1000003, pct: 40, amount: 312 },
  ],
  pending_approval: false,
  total_decided: 2280,
}

describe('toEditorPreview', () => {
  it("shows the server's stage words and names each payer share by the page's chip", () => {
    const preview = toEditorPreview(OUT, (id) =>
      id === 1000001 ? { chip: 1, name: 'The Johnson Family' } : { chip: null, name: null }
    )
    expect(preview).toEqual({
      status: 'ready',
      award: 780,
      trace: OUT.trace,
      stageChange: 'Needs an offer',
      pendingApproval: false,
      totalDecided: 2280,
      shares: [
        {
          householdCmId: 1000001,
          chip: 1,
          householdName: 'The Johnson Family',
          pct: 60,
          amount: 468,
        },
        { householdCmId: 1000003, chip: null, householdName: null, pct: 40, amount: 312 },
      ],
    })
  })

  it('maps an absent total to null', () => {
    const without: ApiAidPreview = { ...OUT }
    delete without.total_decided
    expect(toEditorPreview(without, () => ({ chip: null, name: null })).totalDecided).toBeNull()
  })
})
