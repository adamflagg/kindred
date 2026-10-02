import { describe, expect, it } from 'vitest'

import { GRID_ROWS, ROW_EMMA, ROW_OLIVIA } from './gridFixtures'
import {
  EXCEPTION_BADGES,
  lensCounts,
  lensRows,
  PIPELINE_STAGES,
  resolveStrip,
  shownView,
  stripCsvName,
} from './strip'
import { NO_FILTERS, REQUEST_VIEWS, requestView, viewCounts } from './views'

describe('the views strip (T4; RULED P1, P2, P4)', () => {
  it('runs the pipeline in order (b): Pending approval › Needs an offer › Not reconciled › Waiting on the family', () => {
    expect(PIPELINE_STAGES.map((key) => REQUEST_VIEWS.find((v) => v.key === key)?.label)).toEqual([
      'Pending approval',
      'Needs an offer',
      'Not reconciled',
      'Waiting on the family',
    ])
  })

  it('puts Holds, Duplicates, Session not settled and To reverse on the right, and no Finance approval (no such view)', () => {
    expect(EXCEPTION_BADGES).toEqual(['holds', 'duplicates', 'session_not_settled', 'to_reverse'])
  })
})

describe('resolveStrip (the URL: ?lens=appeals, absent All; ?view=<stage slug>, absent no stage)', () => {
  it('reads no parameters as All with no stage', () => {
    expect(resolveStrip(null, null)).toEqual({ lens: 'all', stage: null })
  })

  it('reads a stage under All, and under the Appeals lens', () => {
    const all = resolveStrip('holds', null)
    expect(all.lens).toBe('all')
    expect(all.stage?.key).toBe('holds')
    const appeals = resolveStrip('needs-offer', 'appeals')
    expect(appeals.lens).toBe('appeals')
    expect(appeals.stage?.key).toBe('needs_offer')
  })

  it('has no fallback for the retired forms: ?view=appeals and ?view=all name no stage and no lens (owner ruling: nothing launched)', () => {
    expect(resolveStrip('appeals', null)).toEqual({ lens: 'all', stage: null })
    expect(resolveStrip('all', null)).toEqual({ lens: 'all', stage: null })
    expect(resolveStrip('bogus', null)).toEqual({ lens: 'all', stage: null })
  })

  it('reads an unknown lens as All, and keeps a stage the strip draws only while picked (Cancelled: give a reason)', () => {
    expect(resolveStrip(null, 'bogus').lens).toBe('all')
    expect(resolveStrip('cancel-reason', null).stage?.key).toBe('cancel_reason')
  })
})

describe('shownView', () => {
  it('is All, or the Appeals view, when no stage is picked', () => {
    expect(shownView('all', null).key).toBe('all')
    expect(shownView('appeals', null)).toBe(requestView('appeals'))
  })

  it('is the stage itself under All', () => {
    expect(shownView('all', requestView('holds'))).toBe(requestView('holds'))
  })

  it("is the stage with the Appeals view's column set under the Appeals lens", () => {
    const shown = shownView('appeals', requestView('needs-offer'))
    expect(shown.key).toBe('needs_offer')
    expect(shown.slug).toBe('needs-offer')
    expect(shown.label).toBe('Needs an offer')
    expect(shown.columns).toEqual(requestView('appeals').columns)
  })
})

describe('lensRows and lensCounts (the lens narrows every count)', () => {
  it('keeps every row under All, and only the appeals under Appeals', () => {
    expect(lensRows(GRID_ROWS, 'all')).toEqual(GRID_ROWS)
    expect(lensRows(GRID_ROWS, 'appeals')).toEqual([ROW_OLIVIA])
  })

  it('recounts each stage to appeals only', () => {
    const counts = viewCounts(lensRows(GRID_ROWS, 'appeals'), NO_FILTERS, true)
    expect(counts.get('needs_offer')).toEqual({ families: 1, requests: 1 })
    expect(counts.get('holds')).toEqual({ families: 0, requests: 0 })
    expect(viewCounts(GRID_ROWS, NO_FILTERS, true).get('needs_offer')?.requests).toBe(2)
  })

  it('counts each lens over the filters, whichever lens is picked', () => {
    const counts = lensCounts(GRID_ROWS, { ...NO_FILTERS, program: 'summer' }, true)
    expect(counts.get('all')?.requests).toBe(
      GRID_ROWS.filter((r) => r.program_key === 'summer').length
    )
    expect(counts.get('appeals')?.requests).toBe(0)
    expect(lensCounts(GRID_ROWS, NO_FILTERS, true).get('appeals')?.requests).toBe(1)
  })

  it('counts only All on a past date, whose queues are null (Decision 11)', () => {
    const past = GRID_ROWS.map((row) => ({ ...row, queues: null }))
    const counts = lensCounts(past, NO_FILTERS, false)
    expect(counts.get('all')?.requests).toBe(GRID_ROWS.length)
    expect(counts.has('appeals')).toBe(false)
  })

  it('keeps the rows themselves (no copies), so memos downstream hold', () => {
    expect(lensRows(GRID_ROWS, 'appeals')[0]).toBe(ROW_OLIVIA)
    expect(lensRows([ROW_EMMA], 'all')[0]).toBe(ROW_EMMA)
  })
})

describe('stripCsvName (D70)', () => {
  const filters = { program: null, pool: null, round: null, tick: null }

  it('names a stage under the Appeals lens as that stage, appeals only', () => {
    expect(stripCsvName('appeals', requestView('needs-offer'), filters, 2027, null)).toBe(
      'camperships-requests-needs-offer-appeals-2027.csv'
    )
  })

  it('names the Appeals lens with no stage as the Appeals view did, and All as All', () => {
    expect(stripCsvName('appeals', requestView('appeals'), filters, 2027, null)).toBe(
      'camperships-requests-appeals-2027.csv'
    )
    expect(stripCsvName('all', requestView('holds'), filters, 2027, null)).toBe(
      'camperships-requests-holds-2027.csv'
    )
  })
})
