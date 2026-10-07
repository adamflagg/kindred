/** Season › History's filters and paging (spec §7.6; D15, D49, D76). Pure. */
import { describe, expect, it } from 'vitest'

import type { ApiAidHistoryRow } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import {
  AGAINST_PARENT,
  DETAIL_POSTED,
  DETAIL_RELEASE,
  DETAIL_RULES_APPROVE,
  DETAIL_RULES_CREATE,
  DETAIL_RULES_SAVE,
  DETAIL_SHARE,
  OP_INTAKE,
  OP_POSTED,
  OP_POSTED_LOCKING,
  OP_POSTED_LOCKING_REGISTRAR,
  OP_RELEASE,
  OP_RULES_APPROVE,
  OP_RULES_SAVE,
  OP_SHARE,
  PAGE,
  REGISTRAR_EMAIL,
  ROW_ROUND3_AWARD,
  row,
} from './historyFixtures'
import {
  KIND_TONE,
  PER_PAGE,
  actionWords,
  actorWords,
  allCount,
  chipKinds,
  codeText,
  compactGroups,
  flattenPages,
  footerWords,
  historyQuery,
  householdHref,
  lastPage,
  openLinks,
  operationWords,
  pageAtScroll,
  pageBreakWords,
  pageStarts,
  parseHistoryFilters,
  parseOpen,
  recordWords,
  requestHref,
  rowView,
  rulesLines,
  rulesLink,
  runSummary,
  scrollRowWords,
  toggleOpen,
  withFilter,
} from './historyModel'
import { changeWords, SECTION_TITLES } from './rules/rulesModel'

const parse = (search: string, rules = true) =>
  parseHistoryFilters(new URLSearchParams(search), rules)

describe('History filters from the URL (D15, D49)', () => {
  it('reads every filter the read takes', () => {
    expect(
      parse(
        'kind=holds&actor=registrar%40example.com&since=2027-03-01&until=2027-04-10&q=phone&intake=1&page=3'
      )
    ).toEqual({
      kind: 'holds',
      actor: 'registrar@example.com',
      since: '2027-03-01',
      until: '2027-04-10',
      q: 'phone',
      intake: true,
      page: 3,
    })
  })

  it('reads the default view from an empty URL', () => {
    expect(parse('')).toEqual({
      kind: null,
      actor: null,
      since: null,
      until: null,
      q: '',
      intake: false,
      page: 1,
    })
  })

  it('drops what the router would refuse, so a pasted link never fails the read', () => {
    expect(parse('kind=scenarios&since=2027-02-30&until=April&page=0')).toMatchObject({
      kind: null,
      since: null,
      until: null,
      page: 1,
    })
    expect(parse('page=2.5').page).toBe(1)
    expect(parse('page=10001').page).toBe(1)
    expect(parse(`q=${'x'.repeat(250)}`).q).toHaveLength(200)
    expect(parse(`actor=${'a'.repeat(400)}`).actor).toHaveLength(320)
    expect(parse('q=%20%20phone%20').q).toBe('phone')
    // A year typed halfway (a date box's 0202-03-01) is a real day but no season's.
    expect(parse('since=0202-03-01&until=2016-12-31').since).toBeNull()
    expect(parse('since=0202-03-01&until=2016-12-31').until).toBeNull()
    expect(parse('since=2017-01-01').since).toBe('2017-01-01')
  })

  it('never asks for Rules without `rules` (D49, D76)', () => {
    expect(parse('kind=rules', false).kind).toBeNull()
    expect(parse('kind=rules', true).kind).toBe('rules')
    expect(chipKinds(false)).toEqual(['offers', 'money', 'holds', 'grants'])
    expect(chipKinds(true)).toEqual(['rules', 'offers', 'money', 'holds', 'grants'])
  })

  it('never takes intake as a chip: intake runs are the tick (D49)', () => {
    expect(parse('kind=intake').kind).toBeNull()
  })
})

describe("the read's query", () => {
  it('sends only what is set, in the router names, and always the page size', () => {
    expect(historyQuery(parse(''))).toEqual({ per_page: String(PER_PAGE) })
    expect(
      historyQuery(
        parse(
          'kind=money&actor=a%40example.com&since=2027-03-01&until=2027-03-31&q=email&intake=1&page=2'
        )
      )
    ).toEqual({
      kind: 'money',
      actor: 'a@example.com',
      since: '2027-03-01',
      until: '2027-03-31',
      q: 'email',
      include_intake: 'true',
      page: '2',
      per_page: '50',
    })
  })
})

describe('writing one filter', () => {
  it('sets or clears it and goes back to page 1, keeping the season, the as-of and the open lines', () => {
    const before = new URLSearchParams(
      'year=2027&as_of=2027-03-15&page=4&open=op0000000000003&kind=money'
    )
    expect(withFilter(before, 'kind', 'holds').toString()).toBe(
      'year=2027&as_of=2027-03-15&open=op0000000000003&kind=holds'
    )
    expect(withFilter(before, 'kind', null).toString()).toBe(
      'year=2027&as_of=2027-03-15&open=op0000000000003'
    )
    expect(withFilter(before, 'q', '').has('q')).toBe(false)
    expect(withFilter(before, 'page', '5').get('page')).toBe('5')
    // The input is never changed: the caller hands it to setSearchParams' updater.
    expect(before.get('page')).toBe('4')
  })
})

describe('open lines (`open=`)', () => {
  it('reads operation ids only, once each', () => {
    expect(parseOpen('op0000000000003,bad,op0000000000003,op0000000000005')).toEqual([
      'op0000000000003',
      'op0000000000005',
    ])
    expect(parseOpen(null)).toEqual([])
    expect(parseOpen('')).toEqual([])
  })

  it('toggles one line, and clears the parameter when none is left open', () => {
    expect(toggleOpen([], 'op0000000000003')).toBe('op0000000000003')
    expect(toggleOpen(['op0000000000003', 'op0000000000005'], 'op0000000000003')).toBe(
      'op0000000000005'
    )
    expect(toggleOpen(['op0000000000003'], 'op0000000000003')).toBeNull()
  })
})

describe('the count line and paging', () => {
  it('knows the last page, which is 1 when nothing matches', () => {
    expect(lastPage({ ...PAGE, total: 101 })).toBe(3)
    expect(lastPage({ ...PAGE, total: 100 })).toBe(2)
    expect(lastPage({ ...PAGE, total: 0 })).toBe(1)
  })
})

const VIEW: AidView = { year: 2027, asOf: { kind: 'past', date: '2027-03-15', axis: 'campminder' } }

const rowAt = <T>(rows: readonly T[], index: number): T => {
  const row = rows[index]
  if (row === undefined) throw new Error('fixture')
  return row
}

const first = <T>(rows: readonly T[]): T => {
  const row = rows[0]
  if (row === undefined) throw new Error('fixture')
  return row
}

describe('who, what kind, and the action words', () => {
  it("names the system's runs, and shows a person by the sign-in the log records", () => {
    expect(actorWords('system:intake')).toBe('Intake')
    expect(actorWords('system:ledger')).toBe('Ledger sync')
    expect(actorWords('system:grant-placement')).toBe('Grant placement')
    expect(actorWords('system:something_new')).toBe('Something new')
    expect(actorWords(REGISTRAR_EMAIL)).toBe(REGISTRAR_EMAIL)
  })

  it('gives each kind its pill tone (history.html B)', () => {
    expect(KIND_TONE).toEqual({
      rules: 'emerald',
      offers: 'sky',
      money: 'amber',
      holds: 'red',
      grants: 'purple',
      intake: 'muted',
    })
  })

  it('words a logged code in sentence case', () => {
    expect(codeText('leave_at_family_level')).toBe('Leave at family level')
    expect(codeText('set_capacity')).toBe('Set capacity')
  })

  it("words the server's own action codes, per collection (⚠ Decision 4)", () => {
    expect(actionWords('aid_decisions', 'post')).toBe('Posted')
    expect(actionWords('aid_decisions', 'unpost')).toBe('Posted undone')
    expect(actionWords('aid_decisions', 'ask')).toBe('Ask entered')
    expect(actionWords('aid_decisions', 'award')).toBe('Round 3 amount entered')
    expect(actionWords('aid_decisions', 'approve')).toBe('Round 3 approved')
    expect(actionWords('aid_rules', 'approve')).toBe('Approved')
    expect(actionWords('aid_hold_events', 'release')).toBe('Released')
    expect(actionWords('aid_payer_shares', 'set_household_share')).toBe('Household share set')
    // The server logs a grant placement on the placement-override collection (I1).
    expect(actionWords('aid_attribution_overrides', 'place_grant')).toBe('Grant placed')
    expect(actionWords('aid_grants', 'withdraw')).toBe('Withdrawn')
    // ⚠1 interim: money-bearing casework codes read as past-tense facts, never "Correct".
    expect(actionWords('aid_application_corrections', 'correct')).toBe('Corrected')
    expect(actionWords('aid_application_corrections', 'cost_override')).toBe('Cost override set')
    expect(actionWords('aid_attribution_overrides', 'place_line')).toBe('Line placed')
    expect(actionWords('aid_attribution_overrides', 'reclassify')).toBe('Reclassified')
    expect(actionWords('aid_flag_dispositions', 'leave_at_family_level')).toBe(
      'Left at family level'
    )
    expect(actionWords('aid_grantors', 'retire')).toBe('Retired')
    expect(actionWords('aid_sources', 'map_grantor')).toBe('Grantor mapped')
    expect(actionWords('aid_requests', 'set_headcount')).toBe('Number of people set')
    // An unknown code reads as its own words.
    expect(actionWords('aid_attribution_overrides', 'leave_at_family_level')).toBe(
      'Leave at family level'
    )
  })

  it('never words a decision "award" or "awarded": a Round 3 amount is Decided (D80)', () => {
    for (const code of [
      'ask',
      'award',
      'approve',
      'refuse',
      'post',
      'unpost',
      'accept',
      'unaccept',
    ]) {
      expect(actionWords('aid_decisions', code)).not.toMatch(/award/i)
    }
  })

  it('names records in the singular and the plural, and an unknown collection by its own words', () => {
    expect(recordWords('aid_decisions', 1)).toBe('decision')
    expect(recordWords('aid_decisions', 7)).toBe('decisions')
    expect(recordWords('aid_application_corrections', 2)).toBe('corrections')
    expect(recordWords('aid_new_thing', 2)).toBe('new thing')
  })
})

describe("an operation's line (D49: one readable line per operation)", () => {
  it('says what was done to how many records, with the reason as recorded', () => {
    expect(operationWords(OP_POSTED)).toEqual({
      when: 'Apr 9 16:05',
      who: REGISTRAR_EMAIL,
      what: 'Posted · 30 requests · 28 families · $42,600 locked',
      reason: null,
    })
    expect(operationWords(OP_RELEASE).what).toBe('Released · 1 request · 1 family')
    expect(operationWords(OP_RELEASE).reason).toBe('Income confirmed by phone')
    expect(operationWords(OP_SHARE).what).toBe('Household share set · 1 request · 2 families')
  })

  it("leads with the screen's action words, then the server's summary as sent (H1: never recomputed)", () => {
    expect(
      operationWords({ ...OP_POSTED, summary: '7 requests · 6 families · $9,840 locked' }).what
    ).toBe('Posted · 7 requests · 6 families · $9,840 locked')
    expect(operationWords(OP_INTAKE).what).toBe('Created, Updated · 5 requests · 3 families')
    expect(operationWords(OP_INTAKE).who).toBe('Intake')
  })

  it('falls back to the counts where the server has no summary (no request or family in it)', () => {
    expect(operationWords({ ...OP_INTAKE, summary: '' }).what).toBe(
      'Created · 3 applications; Updated · 5 requests'
    )
  })

  it('names a rules operation by its version and sections, as the Rules tab names them', () => {
    expect(operationWords({ ...OP_RULES_APPROVE, summary: '', effect: null }).what).toBe(
      `Rules v3 · ${SECTION_TITLES.awards}, ${SECTION_TITLES.budget} · Approved`
    )
    expect(operationWords(OP_RULES_APPROVE).reason).toBe('Finance committee')
    expect(operationWords(OP_RULES_SAVE).what).toBe('Rules v4 · Saved')
    // A created version reads as one (V10): what the server logs for it is create / new_version.
    for (const action of ['create', 'new_version']) {
      expect(
        operationWords({
          ...OP_RULES_SAVE,
          rules_versions: [5],
          counts: [{ entity: 'aid_rules', action, rows: 1 }],
        }).what
      ).toBe('Rules v5 · New version')
    }
    expect(
      operationWords({
        ...OP_RULES_APPROVE,
        summary: '',
        effect: null,
        rules_sections: ['income', 'tiers', 'equity', 'awards'],
        counts: [{ entity: 'aid_rules', action: 'approve', rows: 4 }],
      }).what
    ).toBe('Rules v3 · 4 sections · Approved')
  })

  it('words a Posted tick that locked rules sections by both: its decisions, then its locks (I1)', () => {
    expect(operationWords(OP_POSTED_LOCKING).what).toBe(
      `Posted · 380 requests · 352 families · $539,600 locked; Rules v3 · ${SECTION_TITLES.income}, ${SECTION_TITLES.tiers} · Locked`
    )
  })

  it("follows an approval with its recorded effect, the server's words (H3, #2980)", () => {
    expect(operationWords(OP_RULES_APPROVE).what).toBe(
      `Rules v3 · ${SECTION_TITLES.awards}, ${SECTION_TITLES.budget} · Approved · v3 now prices the season · 41 unsent requests re-priced`
    )
  })

  it("words a registrar's view of the first Posted tick: its decisions alone, no rules part (H6)", () => {
    expect(operationWords(OP_POSTED_LOCKING_REGISTRAR).what).toBe(
      'Posted · 380 requests · 352 families · $539,600 locked'
    )
  })

  it('words a capacity operation (a rules kind with no version) by its count', () => {
    expect(
      operationWords({
        ...OP_RULES_SAVE,
        rules_versions: [],
        counts: [{ entity: 'aid_session_capacity', action: 'set_capacity', rows: 1 }],
      }).what
    ).toBe('Capacity set · 1 session capacity')
  })
})

describe("a rules row's lines (the Rules tab's words; D49)", () => {
  it("lists a setting change in the section's words, and a section's status move", () => {
    expect(rulesLines(first(DETAIL_RULES_SAVE.rows))).toEqual([
      `${SECTION_TITLES.awards} › ${changeWords({ path: ['minimum'], kind: 'changed', before: '250', after: '300' })}`,
      `${SECTION_TITLES.awards}: Approved → Draft`,
    ])
  })

  it('says an approval in one line per section, leaving out who and when (the line says them)', () => {
    expect(DETAIL_RULES_APPROVE.rows.map(rulesLines)).toEqual([
      [`${SECTION_TITLES.awards}: Draft → Approved`],
      [`${SECTION_TITLES.budget}: Draft → Approved`],
    ])
  })

  it('lists a created version against the version it was copied from (H4)', () => {
    const created = { ...first(DETAIL_RULES_CREATE.rows), against_parent: AGAINST_PARENT }
    expect(rulesLines(created)).toEqual([
      'New version v5, from v4:',
      `${SECTION_TITLES.awards} › ${changeWords({ path: ['minimum'], kind: 'changed', before: '300', after: '350' })}`,
      `${SECTION_TITLES.awards}: Approved → Draft`,
    ])
    // Start from last year: the parent is another season's version.
    expect(
      rulesLines({ ...created, against_parent: { ...AGAINST_PARENT, year: 2026, version: 6 } })[0]
    ).toBe('New version v5, from 2026 v6:')
    expect(rulesLines({ ...created, against_parent: { ...AGAINST_PARENT, changes: [] } })).toEqual([
      'New version v5, from v4: no setting changed',
    ])
  })

  it('says a created version with no parent diff in one line, never its every setting as "added" (Decision 3)', () => {
    const created = first(DETAIL_RULES_CREATE.rows)
    expect(created.changes.length).toBeGreaterThan(100)
    expect(rulesLines(created)).toEqual(['New version v5, from v4: its settings open in Rules'])
    expect(rulesLines({ ...created, after: { version: 1, parent_version: 0 } })).toEqual([
      'New version v1: its settings open in Rules',
    ])
  })
})

describe("a row's view in an opened line", () => {
  it("lists a record's own recorded fields, money and percent formatted, bookkeeping left out", () => {
    expect(rowView(first(DETAIL_SHARE.rows))).toEqual({
      head: 'Household share set · payer share · Family emailed',
      lines: [
        'Note: — → Family emailed',
        'Share pct: 100% → 60%',
        'Source: Intake default → Staff',
      ],
      // Task 27 added RowView.fields (the old/new parts); the strike-through test below pins them.
      fields: expect.any(Array),
      hidden: 0,
      // An update logs only what changed; the server names who the row is about (H2).
      householdCmId: 1000001,
      householdName: 'The Johnson Family',
      camperName: 'Emma Johnson',
    })
    expect(rowView(rowAt(DETAIL_SHARE.rows, 1))).toEqual({
      head: 'Household share set · payer share · Family emailed',
      // The household and the request are the row's own link: their ids aren't listed again.
      lines: ['Note: Family emailed', 'Share pct: 40%', 'Source: Staff'],
      // The nested `entered` copy (two values) is counted, not listed.
      // Task 27 added RowView.fields (the old/new parts); the strike-through test below pins them.
      fields: expect.any(Array),
      hidden: 2,
      householdCmId: 1000002,
      householdName: 'The Chen Family',
      camperName: 'Emma Johnson',
    })
  })

  it('reads an amount as the row recorded it, under the action word (⚠ Decision 4)', () => {
    expect(rowView(first(DETAIL_POSTED.rows))).toEqual({
      head: 'Posted · Round 1 decision',
      lines: [
        'Amount: $1,420',
        'Effective on: Apr 9, 2027',
        'Locked by: Posted check',
        'Request: req000000000001',
        'Round: 1',
        'Rules version: 3',
      ],
      // Task 27 added RowView.fields (the old/new parts); the strike-through test below pins them.
      fields: expect.any(Array),
      hidden: 0,
      householdCmId: null,
      householdName: null,
      camperName: null,
    })
  })

  it('reads a lock source as the words staff use, never the raw code', () => {
    const lines = (after: string) =>
      rowView({
        ...first(DETAIL_POSTED.rows),
        changes: [{ path: ['lock_source'], kind: 'added', after }],
      }).lines
    expect(lines('tick')).toEqual(['Locked by: Posted check'])
    expect(lines('ledger')).toEqual(['Locked by: CampMinder match'])
    expect(lines('placement')).toEqual(['Locked by: Grant placement'])
    expect(lines('some_new_code')).toEqual(['Locked by: Some new code'])
  })

  it('never shows "award" on a Round 3 amount, which is Decided, not posted (D80)', () => {
    const view = rowView(ROW_ROUND3_AWARD)
    expect(view.head).toBe('Round 3 amount entered · Round 3 decision')
    expect(view.lines).toContain('Amount: $500')
    expect(view.lines).toContain('Needs approval: yes')
    expect(JSON.stringify(view)).not.toMatch(/award/i)
  })

  it('words a hold code as the grid does, and keeps the note', () => {
    expect(rowView(first(DETAIL_RELEASE.rows))).toEqual({
      head: 'Released · hold: Placeholder income · Income confirmed by phone',
      lines: [
        'Code: Placeholder income',
        'Note: Income confirmed by phone',
        'Request: req000000000004',
      ],
      // Task 27 added RowView.fields (the old/new parts); the strike-through test below pins them.
      fields: expect.any(Array),
      hidden: 0,
      householdCmId: null,
      householdName: null,
      camperName: null,
    })
  })

  it('counts the nested details it does not list', () => {
    const posted = first(DETAIL_POSTED.rows)
    expect(
      rowView({
        ...posted,
        changes: [...posted.changes, { path: ['snapshot', 'tier'], kind: 'added', after: 3 }],
      }).hidden
    ).toBe(1)
  })

  it('words a change and a removal, the log holding decimals as strings', () => {
    expect(
      rowView({
        ...first(DETAIL_SHARE.rows),
        before: { share_pct: '40', amount: '1200' },
        after: { share_pct: '60' },
        changes: [
          { path: ['amount'], kind: 'removed', before: '1200' },
          { path: ['share_pct'], kind: 'changed', before: '40', after: '60' },
        ],
      }).lines
    ).toEqual(['Amount: removed (was $1,200)', 'Share pct: 40% → 60%'])
  })

  it('still formats a number, and prints a value that is not a finite number as recorded', () => {
    const lines = (changes: ApiAidHistoryRow['changes']) =>
      rowView({ ...first(DETAIL_SHARE.rows), changes }).lines
    expect(lines([{ path: ['amount'], kind: 'added', after: 1420 }])).toEqual(['Amount: $1,420'])
    expect(lines([{ path: ['share_pct'], kind: 'added', after: 40 }])).toEqual(['Share pct: 40%'])
    expect(lines([{ path: ['amount'], kind: 'added', after: 'n/a' }])).toEqual(['Amount: n/a'])
    expect(lines([{ path: ['amount'], kind: 'added', after: 'NaN' }])).toEqual(['Amount: NaN'])
    expect(lines([{ path: ['amount'], kind: 'added', after: 'Infinity' }])).toEqual([
      'Amount: Infinity',
    ])
    expect(lines([{ path: ['amount'], kind: 'added', after: ' ' }])).toEqual(['Amount: ' + ' '])
    expect(lines([{ path: ['share_pct'], kind: 'added', after: 'lots' }])).toEqual([
      'Share pct: lots',
    ])
    expect(lines([{ path: ['amount'], kind: 'added', after: '1420.50' }])).toEqual([
      'Amount: $1,420.50',
    ])
  })

  it("formats an intake request's own ask, a float the log keeps as `ask` (I2)", () => {
    const view = rowView({
      ...ROW_ROUND3_AWARD,
      entity: 'aid_requests',
      entity_id: 'req000000000012',
      action: 'create',
      after: { ask: 1200, request: 'req000000000012' },
      changes: [
        { path: ['ask'], kind: 'added', after: 1200 },
        { path: ['request'], kind: 'added', after: 'req000000000012' },
      ],
    })
    expect(view.lines).toEqual(['Ask: $1,200', 'Request: req000000000012'])
  })

  it("words a cancellation's reason code as the cancel form words it, and an unknown one as recorded", () => {
    const cancel = (reason: string) =>
      rowView({
        ...ROW_ROUND3_AWARD,
        entity: 'aid_cancellations',
        entity_id: 'req000000000011',
        action: 'cancel',
        after: { reason },
        changes: [{ path: ['reason'], kind: 'added', after: reason }],
      }).lines
    expect(cancel('did_not_want_to_appeal')).toEqual(['Reason: did not want to appeal'])
    expect(cancel('something_new')).toEqual(['Reason: something_new'])
  })

  it('reads an ask as the amount of an ask action: there is no ask field in the log', () => {
    const view = rowView({
      ...ROW_ROUND3_AWARD,
      entity_id: 'req000000000011:1',
      action: 'ask',
      after: { amount: '1800', event: 'ask', request: 'req000000000011', round: 1 },
      changes: [
        { path: ['amount'], kind: 'added', after: '1800' },
        { path: ['event'], kind: 'added', after: 'ask' },
        { path: ['request'], kind: 'added', after: 'req000000000011' },
        { path: ['round'], kind: 'added', after: 1 },
      ],
    })
    expect(view.head).toBe('Ask entered · Round 1 decision')
    expect(view.lines).toEqual(['Amount: $1,800', 'Request: req000000000011', 'Round: 1'])
  })

  it('heads a rules row with its version and section', () => {
    expect(rowView(first(DETAIL_RULES_APPROVE.rows)).head).toBe(
      `Approved · v3 · ${SECTION_TITLES.awards} · Finance committee`
    )
  })
})

describe("links (D148: the season; D15: the page's as-of, as the Rules tab keeps it)", () => {
  it("opens the operation's newest rules version, at its first section when it touched any", () => {
    expect(rulesLink(OP_RULES_SAVE, VIEW)).toEqual({
      label: 'Open v4 in Rules ›',
      href: '/aid/season/rules?version=4&year=2027&as_of=2027-03-15',
    })
    expect(rulesLink(OP_RULES_APPROVE, VIEW)?.href).toBe(
      '/aid/season/rules?version=3&section=awards&year=2027&as_of=2027-03-15'
    )
    expect(rulesLink(OP_POSTED, VIEW)).toBeNull()
  })

  it("opens a household on the season, keeping the page's as-of", () => {
    expect(householdHref(1000002, VIEW)).toBe('/aid/households/1000002?year=2027&as_of=2027-03-15')
  })
})

describe("who a row is about (H2: the server's names)", () => {
  it('names the household the server names, "Household N" where it has no record this season', () => {
    const named = rowAt(DETAIL_SHARE.rows, 1)
    expect(rowView({ ...named, household_name: null }).householdName).toBe('Household 1000002')
    expect(rowView({ ...named, household_name: null, camper_name: null }).camperName).toBeNull()
  })

  it('falls back to the household the row recorded when the server names none', () => {
    const named = rowAt(DETAIL_SHARE.rows, 1)
    const view = rowView({ ...named, household_cm_id: null, household_name: null })
    expect(view.householdCmId).toBe(1000002)
    expect(view.householdName).toBe('Household 1000002')
  })
})

describe("an opened row's words: no raw ids or codes where words exist (#18)", () => {
  const base = first(DETAIL_SHARE.rows)
  const unlinked = { ...base, household_cm_id: null, household_name: null, camper_name: null }
  const view = (
    entity: string,
    after: Record<string, unknown>,
    extra: Partial<ApiAidHistoryRow> = {},
    sessions?: ReadonlyMap<number, string>
  ) =>
    rowView(
      {
        ...unlinked,
        entity,
        entity_id: 'abcdefghij12345',
        action: 'create',
        reason: '',
        before: null,
        after,
        changes: Object.entries(after).map(([key, value]) => ({
          path: [key],
          kind: 'added' as const,
          after: value,
        })),
        ...extra,
      },
      sessions
    )

  it('reads create and update as past-tense verbs, as Placed and Corrected do', () => {
    expect(actionWords('aid_grants', 'create')).toBe('Created')
    expect(actionWords('aid_grants', 'update')).toBe('Updated')
    expect(actionWords('aid_grants', 'delete')).toBe('Deleted')
    expect(actionWords('aid_rules', 'create')).toBe('New version')
  })

  it("reads an income correction's field in words and its figures as money", () => {
    expect(
      view('aid_application_corrections', {
        field: 'total_gross_income',
        previous_value: '95000.00',
        value: '60000.00',
      }).lines
    ).toEqual(['Field: Total gross income', 'Previous value: $95,000', 'Value: $60,000'])
    expect(view('aid_applications', { total_gross_income: '60000' }).lines).toEqual([
      'Total gross income: $60,000',
    ])
  })

  it("names a session by the season's name, else by its number", () => {
    const sessions = new Map([[9300102, 'Session 2']])
    expect(view('aid_requests', { session_cm_id: 9300102 }, {}, sessions).lines).toEqual([
      'Session: Session 2',
    ])
    expect(view('aid_requests', { session_cm_id: 9300199 }).lines).toEqual(['Session: 9300199'])
    // A capacity names its session in the head, never its record id.
    const capacity = view(
      'aid_session_capacity',
      { session_cm_id: 9300102, capacity: 150 },
      { action: 'set_capacity' },
      sessions
    )
    expect(capacity.head).toBe('Capacity set · session capacity · Session 2')
  })

  it('reads a grantor, a household, a source and a status in words, and a date as staff write it', () => {
    expect(view('aid_grants', { grantor_key: 'partner_fund_b' }).lines).toEqual([
      'Grantor: Partner fund b',
    ])
    // A household the row recorded is its link: not listed again as an id.
    const recorded = view('aid_grants', { household_cm_id: 9100111 })
    expect(recorded.lines).toEqual([])
    expect(recorded.householdName).toBe('Household 9100111')
    // Another household than the one the row is about is listed, by its number.
    expect(
      view(
        'aid_grants',
        { household_cm_id: 9100111 },
        { household_cm_id: 9100108, household_name: 'The Rivera Family' }
      ).lines
    ).toEqual(['Household: Household 9100111'])
    expect(view('aid_requests', { status: 'duplicate_pending' }).lines).toEqual([
      'Status: Duplicate pending',
    ])
    expect(view('aid_payer_shares', { source: 'intake_default' }).lines).toEqual([
      'Source: Intake default',
    ])
    expect(view('aid_grants', { received_on: '2026-08-22' }).lines).toEqual([
      'Received on: Aug 22, 2026',
    ])
  })

  it('drops a record id from the head when the row links its household or camper, and keeps it when nothing else names it', () => {
    const linked = { household_cm_id: 9100111, household_name: 'The Rivera Family' }
    const grant = view(
      'aid_grant_placements',
      { grant: 'commitment:abcdefghij12345' },
      {
        ...linked,
        action: 'place',
        entity_id: 'commitment:abcdefghij12345',
      }
    )
    expect(grant.head).toBe('Placed · grant placement')
    expect(grant.lines).toEqual([])
    const alone = view(
      'aid_grant_placements',
      { grant: 'commitment:abcdefghij12345' },
      {
        action: 'place',
        entity_id: 'commitment:abcdefghij12345',
      }
    )
    expect(alone.head).toBe('Placed · grant placement commitment:abcdefghij12345')
    expect(alone.lines).toEqual(['Grant: commitment:abcdefghij12345'])
  })

  it("words a hold's code in its head, never the record id and the raw code", () => {
    const lifted = view(
      'aid_hold_events',
      {},
      {
        action: 'lift',
        entity_id: 'abcdefghij12345:manual_hold',
      }
    )
    expect(lifted.head).toBe('Lifted · hold: On hold')
  })
})

describe("a rules diff's lines in the Rules read view's static words", () => {
  it('names a check and its severity as the Rules tab does, not their codes', () => {
    const lines = rulesLines({
      ...first(DETAIL_RULES_SAVE.rows),
      changes: [
        {
          path: ['document', 'quality_checks', 'checks', 'expense_above', 'severity'],
          kind: 'changed',
          before: 'warn',
          after: 'hold',
        },
      ],
    })
    expect(lines).toEqual([
      `${SECTION_TITLES.quality_checks} › Checks › High expenses › Severity: Warning → Hold`,
    ])
  })
})

describe("a rules diff's tiers in number order (#18)", () => {
  it('lists Tier 2 before Tier 10, leaving every other line where it was', () => {
    const tier = (n: string, after: string) => ({
      path: ['document', 'round2', 'tables', 'summer', 'tiers', n, 'total_pct'],
      kind: 'changed' as const,
      before: '50',
      after,
    })
    const lines = rulesLines({
      ...first(DETAIL_RULES_SAVE.rows),
      changes: [
        tier('1', '91'),
        tier('10', '21'),
        tier('11', '17'),
        tier('2', '97'),
        {
          path: ['section_status', 'round2', 'state'],
          kind: 'changed',
          before: 'approved',
          after: 'draft',
        },
      ],
    })
    expect(lines.map((line) => line.match(/Tier (\d+)/)?.[1] ?? line)).toEqual([
      '1',
      '2',
      '10',
      '11',
      `${SECTION_TITLES.round2}: Approved → Draft`,
    ])
  })
})

describe('an old log row naming a culled rules section', () => {
  // Regression guard: passes before and after the cull, because a section the map no longer
  // holds falls back to its own key's words.
  it('names a rules section the map no longer holds by its own words (an old log row)', () => {
    const op = { ...OP_RULES_APPROVE, rules_sections: ['stages'] }
    expect(operationWords(op).what).toContain('Stages')
  })
})

// ── Task 27: the box, compact groups and the Open links (spec §7.2 C, D) ──────

// The file's VIEW above is a past date; these read the live season, as the plan's tests do.
const LIVE: AidView = { year: 2027, asOf: { kind: 'live' } }
const op = (id: string) => ({ ...OP_POSTED, operation_id: id })
const pageOf = (n: number, ids: string[], total = 112) => ({
  ...PAGE,
  page: n,
  per_page: 50,
  total,
  operations: ids.map(op),
})

describe('the box (spec §7.2 C)', () => {
  it('flattenPages drops an operation already shown and keeps order (Review Focus 4)', () => {
    const pages = [
      pageOf(1, ['a'.repeat(15), 'b'.repeat(15)]),
      pageOf(2, ['b'.repeat(15), 'c'.repeat(15)]),
    ]
    expect(flattenPages(pages).map((o) => o.operation_id)).toEqual(
      ['a', 'b', 'c'].map((c) => c.repeat(15))
    )
  })

  it('marks where each later page starts, after dedupe', () => {
    const pages = [
      pageOf(1, ['a'.repeat(15), 'b'.repeat(15)]),
      pageOf(2, ['b'.repeat(15), 'c'.repeat(15)]),
    ]
    expect(pageStarts(pages)).toEqual([{ page: 2, index: 2 }])
  })

  it('says the page break, the scroll row and the footer in the mock words', () => {
    expect(pageBreakWords(2, 50, 112)).toBe('Page 2 · 51–100')
    expect(pageBreakWords(3, 50, 112)).toBe('Page 3 · 101–112')
    expect(scrollRowWords(50, 112, 50, false)).toBe('Scroll for 51–100')
    expect(scrollRowWords(50, 112, 50, true)).toBe('◌ Loading 51–100…')
    expect(scrollRowWords(112, 112, 50, false)).toBeNull()
    expect(footerWords(112, 50, 1, 3)).toEqual({
      count: '112 operations',
      pageOf: 'Page 1 of 3',
      onScreen: '· 1–50 on screen; scroll for more',
    })
    expect(footerWords(1, 1, 1, 1)).toEqual({
      count: '1 operation',
      pageOf: 'Page 1 of 1',
      onScreen: '· all on screen',
    })
  })

  it('follows the row at the top of the box to its page', () => {
    expect(pageAtScroll([0, 1800, 3600], 0)).toBe(1)
    expect(pageAtScroll([0, 1800, 3600], 1799)).toBe(1)
    expect(pageAtScroll([0, 1800, 3600], 1800)).toBe(2)
    expect(pageAtScroll([0, 1800, 3600], 9999)).toBe(3)
  })

  it('allCount is the total with no kind picked, the kinds summed with one picked (H5)', () => {
    expect(allCount(undefined, null)).toBeNull()
    expect(allCount({ ...PAGE, total: 112 }, null)).toBe(112)
    expect(allCount(PAGE, 'holds')).toBe(PAGE.kind_counts.reduce((sum, c) => sum + c.operations, 0))
  })
})

describe('the opened row (spec §7.2 D)', () => {
  it('groups 3+ request rows with one action into a compact table with the total as recorded', () => {
    const named = DETAIL_POSTED.rows.slice(0, 3).map((r, i) => ({
      ...r,
      household_cm_id: 1000001 + i,
      household_name: 'The Johnson Family',
      camper_name: 'Emma Johnson',
      request_id: `req${String(i + 1).padStart(12, '0')}`,
      session_cm_id: 1000102,
    }))
    const { groups, rest } = compactGroups(named, LIVE, new Map([[1000102, 'Session 2']]))
    expect(rest).toEqual([])
    const [group] = groups
    expect(group?.head).toBe('Posted · 3 requests')
    expect(group?.amountLabel).toBe('Amount')
    expect(group?.total).toBe(4260)
    expect(group?.rows[0]).toMatchObject({
      camper: 'Emma Johnson',
      camperHref: '/aid/households/1000001?year=2027#request-req000000000001',
      household: 'The Johnson Family',
      session: 'Session 2',
      round: 'R1',
      amount: 1420,
    })
  })

  it('requestHref: a camper links to its request on the household page, keeping the as-of (spec §7.5)', () => {
    const r = {
      ...first(DETAIL_POSTED.rows),
      camper_name: 'Emma Johnson',
      request_id: 'req000000000001',
    }
    expect(requestHref(r, 1000001, LIVE)).toBe(
      '/aid/households/1000001?year=2027#request-req000000000001'
    )
    expect(
      requestHref(r, 1000001, {
        year: 2027,
        asOf: { kind: 'past', date: '2027-03-01', axis: 'campminder' },
      })
    ).toBe('/aid/households/1000001?year=2027&as_of=2027-03-01#request-req000000000001')
    expect(requestHref({ ...r, request_id: null }, 1000001, LIVE)).toBeNull()
    expect(requestHref({ ...r, camper_name: null }, 1000001, LIVE)).toBeNull()
    expect(requestHref(r, null, LIVE)).toBeNull()
  })

  it('leaves two such rows as row blocks', () => {
    const { groups, rest } = compactGroups(DETAIL_POSTED.rows.slice(0, 2), LIVE)
    expect(groups).toEqual([])
    expect(rest).toHaveLength(2)
  })

  it('a family-level row reads "—" for the camper', () => {
    const famRows = DETAIL_POSTED.rows
      .slice(0, 3)
      .map((r) => ({ ...r, camper_name: null, household_cm_id: 1000001 }))
    expect(compactGroups(famRows, LIVE).groups[0]?.rows[0]?.camper).toBe('—')
  })

  it('an intake run says what else it did', () => {
    const rows = [
      ...Array.from({ length: 2 }, () =>
        row({ entity: 'aid_payer_shares', entity_id: 'x', action: 'create' })
      ),
      row({ entity: 'aid_applications', entity_id: 'y', action: 'create' }),
    ]
    expect(runSummary(rows)).toBe('2 × created · payer share · 1 × created · application')
  })

  it('Open: households up to 3, the full list at 3+ requests, the families line past 3', () => {
    const rows = DETAIL_POSTED.rows.slice(0, 5).map((r, i) => ({
      ...r,
      household_cm_id: 1000001 + i,
      household_name: null,
      camper_name: 'Emma Johnson',
      request_id: `req${String(i + 1).padStart(12, '0')}`,
    }))
    const links = openLinks(OP_POSTED, rows, LIVE)
    expect(links.households).toEqual([])
    expect(links.manyFamilies).toBe('5 families: each name in the list opens its household')
    expect(links.fullList).toEqual({
      label: 'Full list in Requests (5) ›',
      href: `/aid/requests?op=${OP_POSTED.operation_id}&year=2027`, // aidHref puts its extra keys before the season
    })
    expect(openLinks(OP_RULES_APPROVE, [], LIVE).rules?.label).toMatch(/^Open v\d+ in Rules ›$/)
    expect(openLinks({ ...OP_POSTED, rules_versions: [] }, [], LIVE).nothing).toBe(
      'Nothing to open: no household or rules version'
    )
  })

  it('reads a change as its old and new parts, for the strike-through', () => {
    const changed = row({
      entity: 'aid_applications',
      entity_id: 'app',
      action: 'update',
      changes: [{ path: ['total_gross_income'], kind: 'changed', before: '95000', after: '60000' }],
    })
    expect(rowView(changed).fields).toEqual([
      { label: 'Total gross income', kind: 'changed', before: '$95,000', after: '$60,000' },
    ])
  })
})
