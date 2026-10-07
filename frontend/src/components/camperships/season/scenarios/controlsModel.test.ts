import { describe, expect, it } from 'vitest'

import {
  changeWords,
  formatPileMoment,
  fromName,
  nothingNewWords,
  parseView,
  pillWords,
  requestSetParam,
  requestSetWords,
  startEntries,
} from './controlsModel'
import { scenarioDraft, workspace } from './scenarioFixtures'

const SNAPSHOT = {
  id: 'snp000000000001',
  taken_at: '2027-02-03T22:10:00Z',
  taken_by: 'Test User',
  requests: 180,
  awaiting_rules: 0,
}

describe('the held pile (§S5 A2–A3; N5)', () => {
  it('says how many applications and as of when, on camp time', () => {
    expect(formatPileMoment('2027-02-03T22:10:00Z')).toBe('Feb 3, 2:10 pm')
    expect(pillWords(SNAPSHOT)).toBe('180 applications · as of Feb 3, 2:10 pm')
    expect(pillWords({ ...SNAPSHOT, requests: 1 })).toBe('1 application · as of Feb 3, 2:10 pm')
  })

  it('adds the requests waiting for approved rules, and says when nothing is held', () => {
    expect(pillWords({ ...SNAPSHOT, awaiting_rules: 3 })).toBe(
      '180 applications · as of Feb 3, 2:10 pm · 3 held until the rules are approved'
    )
    expect(pillWords(null)).toBe('No applications held yet')
    expect(nothingNewWords(SNAPSHOT)).toBe('Nothing new since Feb 3, 2:10 pm')
  })
})

describe('Start from (§S5 A5; §S15 item 4)', () => {
  it('offers the rules in effect, the rules draft only while it differs, and last season', () => {
    const differs = workspace({
      pricing_version: 4,
      rules_version: 5,
      rules_draft_version: 5,
      last_rules_version: 3,
    })
    expect(startEntries(differs)).toEqual([
      { value: 'rules', label: 'Rules in effect · v4', disabled: false },
      { value: 'rules_draft', label: 'Rules draft · v5', disabled: false },
      { value: 'last_rules', label: "Last season's rules", disabled: false },
    ])
    const same = workspace({
      pricing_version: 4,
      rules_version: 4,
      rules_draft_version: null,
      last_rules_version: 3,
    })
    expect(startEntries(same).map((e) => e.value)).toEqual(['rules', 'last_rules'])
  })

  it('names the draft first when no version is in effect, and disables last season with none approved', () => {
    const none = workspace({
      pricing_version: null,
      rules_version: 2,
      rules_draft_version: null,
      last_rules_version: null,
    })
    expect(startEntries(none)).toEqual([
      { value: 'rules', label: 'Rules draft · v2', disabled: false },
      { value: 'last_rules', label: "Last season's rules (none approved)", disabled: true },
    ])
  })

  it('names what the draft is from, as the strip says it', () => {
    const ws = workspace({ pricing_version: 4, rules_version: 5, rules_draft_version: 5 })
    expect(fromName(scenarioDraft({ from_code: 'rules' }), ws)).toBe('Rules v4')
    expect(fromName(scenarioDraft({ from_code: 'rules_draft' }), ws)).toBe('Rules draft v5')
    expect(fromName(scenarioDraft({ from_code: 'last_rules' }), ws)).toBe("last season's rules")
    expect(fromName(scenarioDraft({ from_code: 'B' }), ws)).toBe('B')
  })
})

describe('the change count (§S5 A6)', () => {
  it('counts, and says what the sandbox is the same as', () => {
    const ws = workspace({ pricing_version: 4 })
    expect(changeWords(0, null, ws)).toBeNull()
    expect(changeWords(1, null, ws)).toBe('1 change')
    expect(changeWords(4, 'B', ws)).toBe('4 changes, same as B')
    expect(changeWords(2, 'rules', ws)).toBe('2 changes, same as Rules v4')
  })
})

describe('the URL view (§S5 L)', () => {
  it('reads each param, and an old trail link as the sandbox', () => {
    const view = parseView(
      new URLSearchParams(
        'panel=compare&through=deadline&compare=B,A,b,B&rules=1&lastrules=1&draft=1&last=1&tiers=1'
      )
    )
    expect(view).toEqual({
      panel: 'compare',
      requestSet: { kind: 'deadline' },
      codes: ['B', 'A'],
      rules: true,
      lastRules: true,
      draft: true,
      lastSeason: true,
      byTier: true,
      anyColumn: true,
    })
    const old = parseView(new URLSearchParams('panel=trail&trail_page=3&through=2027-02-30'))
    expect([old.panel, old.requestSet, old.anyColumn]).toEqual(['sandbox', { kind: 'all' }, false])
  })

  it('writes a request set back, and words it for the corner cell', () => {
    expect([
      requestSetParam({ kind: 'all' }),
      requestSetParam({ kind: 'deadline' }),
      requestSetParam({ kind: 'date', date: '2027-02-01' }),
    ]).toEqual([null, 'deadline', '2027-02-01'])
    expect(requestSetWords({ kind: 'all' }, null)).toBe('the applications held')
    expect(requestSetWords({ kind: 'deadline' }, '2027-02-01')).toBe(
      'received through Feb 1 (the Round 1 deadline)'
    )
    expect(requestSetWords({ kind: 'date', date: '2027-01-20' }, '2027-01-20')).toBe(
      'received through Jan 20'
    )
  })
})
