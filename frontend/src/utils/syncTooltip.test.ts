import { describe, expect, it } from 'vitest'

import { buildSyncTooltip } from './syncTooltip'

describe('buildSyncTooltip (moved from AppLayout, unchanged)', () => {
  it('names the job, its end time, its status and its counts', () => {
    expect(
      buildSyncTooltip('aid ledger', {
        status: 'success',
        end_time: '2026-10-01T14:00:00Z',
        summary: { created: 1, updated: 2, skipped: 3, errors: 0 },
      })
    ).toBe(
      'Last aid ledger sync • 2026-10-01T14:00:00.000Z • status: success • created 1, updated 2, skipped 3, errors 0'
    )
  })

  it('leaves out what a status does not carry', () => {
    expect(buildSyncTooltip('aid ledger', { status: 'idle' })).toBe(
      'Last aid ledger sync • status: idle'
    )
  })
})
