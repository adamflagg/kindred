import { describe, expect, it } from 'vitest'

import { GRID_ROWS, ROW_EMMA, ROW_OLIVIA } from './gridFixtures'
import {
  badgeTone,
  EXCEPTION_BADGES,
  foldBadges,
  foldTone,
  lensCounts,
  lensRows,
  PIPELINE_STAGES,
  resolveStrip,
  shownBadges,
  shownView,
  BADGE_TITLES,
  lensTitle,
  stageTitle,
  stripCsvName,
} from './strip'
import {
  NO_FILTERS,
  REQUEST_VIEWS,
  requestView,
  viewCounts,
  type RequestViewKey,
  type ViewCount,
} from './views'

const count = (requests: number): ViewCount => ({ families: requests, requests })
const countsOf = (entries: ReadonlyArray<[RequestViewKey, number]>) =>
  new Map<RequestViewKey, ViewCount>(entries.map(([key, n]) => [key, count(n)]))

describe('the views strip (T4; RULED P1, P2, P4)', () => {
  it('runs the pipeline in order (b): Pending approval › Needs an offer › Not reconciled › Waiting on the family', () => {
    expect(PIPELINE_STAGES.map((key) => REQUEST_VIEWS.find((v) => v.key === key)?.label)).toEqual([
      'Pending approval',
      'Needs an offer',
      'Not reconciled',
      'Waiting on the family',
    ])
  })

  it('puts Holds, Duplicates, Session unclear and To reverse on the right, and no Finance approval (no such view) and no cancel-reason badge (owner ruling B: the reason is optional)', () => {
    expect(EXCEPTION_BADGES).toEqual(['holds', 'duplicates', 'session_not_settled', 'to_reverse'])
  })
})

// Final language §6 (owner 1a/1b: "I don't like when the nav pushes down further only sometimes"): the
// strip's legend line is gone, and each clause rides in a native title on the element it explains.
describe('the strip’s words live in titles (§6; answers 1a, 1b)', () => {
  it('says what each lens is, and that it narrows every count', () => {
    expect(lensTitle('all')).toBe('All: every request. The lens narrows every count on the strip.')
    expect(lensTitle('appeals')).toBe(
      'Appeals: requests with a Round 2 or later ask. The lens narrows every count on the strip.'
    )
  })

  it('says how a pipeline stage reads', () => {
    expect(stageTitle('Needs an offer')).toBe(
      'Needs an offer: stages run left to right, per round.'
    )
  })

  it('carries each badge’s warning, including Session unclear’s', () => {
    expect(Object.keys(BADGE_TITLES).sort()).toEqual([...EXCEPTION_BADGES].sort())
    expect(BADGE_TITLES['session_not_settled']).toBe(
      'Session unclear: no one enrolled session matches the request yet. It settles when the camper enrolls, or use Settle Session… on the household page.'
    )
    expect(BADGE_TITLES['holds']).toBe(
      "On hold: a hold stops the request at any stage until it is released. The row's Needs attention chip says which."
    )
    expect(BADGE_TITLES['duplicates']).toBe(
      'Duplicates: two requests look like the same camper and session. Open the household to keep one.'
    )
    expect(BADGE_TITLES['to_reverse']).toBe(
      'To reverse: cancelled, withdrawn or a duplicate, and camp aid is still live in CampMinder. Reverse it there.'
    )
  })
})

describe('shownBadges (owner 2026-10-04: a badge shows only when something is in it, or it is picked)', () => {
  const allZero = countsOf(EXCEPTION_BADGES.map((key) => [key, 0]))

  it.each(EXCEPTION_BADGES)('hides %s at 0', (key) => {
    expect(shownBadges(null, allZero)).not.toContain(key)
  })

  it.each(EXCEPTION_BADGES)('keeps %s at 0 while it is the picked stage', (key) => {
    expect(shownBadges(key, allZero)).toEqual([key])
  })

  it.each(EXCEPTION_BADGES)('shows %s when its count is above 0', (key) => {
    expect(shownBadges(null, countsOf([[key, 1]]))).toEqual([key])
  })

  it('keeps the badge order whatever is shown', () => {
    expect(
      shownBadges(
        'duplicates',
        countsOf([
          ['to_reverse', 1],
          ['holds', 2],
          ['session_not_settled', 0],
        ])
      )
    ).toEqual(['holds', 'duplicates', 'to_reverse'])
  })

  it('draws no badge while the counts load (no flash of zeros), but keeps the picked one', () => {
    expect(shownBadges(null, null)).toEqual([])
    expect(shownBadges('holds', null)).toEqual(['holds'])
  })

  it('draws no badge it cannot count (a past date counts only All, Decision 11), but keeps the picked one', () => {
    const past = countsOf([['all', 9]])
    expect(shownBadges(null, past)).toEqual([])
    expect(shownBadges('to_reverse', past)).toEqual(['to_reverse'])
  })
})

describe('badgeTone and foldTone', () => {
  it('tones a badge red, an unsettled session amber, and an empty one zero', () => {
    expect(badgeTone('holds', count(2))).toBe('red')
    expect(badgeTone('session_not_settled', count(1))).toBe('amber')
    expect(badgeTone('holds', count(0))).toBe('zero')
    expect(badgeTone('session_not_settled', undefined)).toBe('zero')
  })

  it('tones the +N chip red if any folded badge is red, else amber if any is amber, else zero', () => {
    const counts = countsOf([
      ['session_not_settled', 1],
      ['to_reverse', 2],
      ['holds', 0],
    ])
    expect(foldTone(['session_not_settled', 'to_reverse'], counts)).toBe('red')
    expect(foldTone(['session_not_settled', 'holds'], counts)).toBe('amber')
    expect(foldTone(['holds'], counts)).toBe('zero')
    expect(foldTone(['to_reverse'], null)).toBe('zero')
  })
})

describe('foldBadges (how many badges stay on the line; the rest fold into +N)', () => {
  it('keeps every badge when they fit, gaps included, exactly at the edge', () => {
    expect(foldBadges([100, 100, 100], 40, 308, 4)).toBe(3)
    expect(foldBadges([100, 100, 100], 40, 400, 4)).toBe(3)
  })

  it('folds the trailing badges, leaving room for the chip and its gap', () => {
    // 100 + 4 + 100 + 4 + 40 = 248
    expect(foldBadges([100, 100, 100], 40, 307, 4)).toBe(2)
    expect(foldBadges([100, 100, 100], 40, 248, 4)).toBe(2)
    expect(foldBadges([100, 100, 100], 40, 247, 4)).toBe(1)
    expect(foldBadges([100, 100, 100], 40, 144, 4)).toBe(1)
  })

  it('folds everything into the chip when not even one badge fits beside it', () => {
    expect(foldBadges([100, 100, 100], 40, 143, 4)).toBe(0)
    expect(foldBadges([100, 100, 100], 40, 0, 4)).toBe(0)
    expect(foldBadges([100, 100, 100], 40, -50, 4)).toBe(0)
  })

  it('reads each badge at its own width, folding from the end', () => {
    // All four: 350 + 3 gaps = 362. Three and the chip: 270 + 40 + 3 gaps = 322. Two: 198.
    expect(foldBadges([60, 90, 120, 80], 40, 362, 4)).toBe(4)
    expect(foldBadges([60, 90, 120, 80], 40, 361, 4)).toBe(3)
    expect(foldBadges([60, 90, 120, 80], 40, 322, 4)).toBe(3)
    expect(foldBadges([60, 90, 120, 80], 40, 321, 4)).toBe(2)
    expect(foldBadges([60, 90, 120, 80], 40, 198, 4)).toBe(2)
    expect(foldBadges([60, 90, 120, 80], 40, 197, 4)).toBe(1)
  })

  it('has nothing to fold with no badges', () => {
    expect(foldBadges([], 40, 0, 4)).toBe(0)
  })

  it('tolerates floating-point noise at the edge, not a real overrun', () => {
    expect(foldBadges([100.4, 100.4], 40, 204.8, 4)).toBe(2)
    expect(foldBadges([100.4, 100.4], 40, 204.7, 4)).toBe(1)
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

  it('reads an unknown lens as All, and the retired ?view=cancel-reason as no stage (owner ruling B)', () => {
    expect(resolveStrip(null, 'bogus').lens).toBe('all')
    expect(resolveStrip('cancel-reason', null)).toEqual({ lens: 'all', stage: null })
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
      GRID_ROWS.filter((r) => r.program_family === 'summer').length
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
