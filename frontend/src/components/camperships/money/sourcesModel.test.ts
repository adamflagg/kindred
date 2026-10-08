/** Money › Sources' words and edit bodies (§8.1; D88, D100, D105, D159; P-12 to P-14; ruling H). */
import { describe, expect, it } from 'vitest'

import {
  REG_CAMP_SUMMER,
  FUNDING_SOURCES_2027,
  REG_GRANTOR_A_GRANT,
  REG_GRANTOR_E_NEW,
  REG_NOT_AID,
  SOURCES_2027,
  REG_UNCLASSIFIED,
} from './registryFixtures'
import {
  canNameGrantor,
  draftFrom,
  dropsGrantor,
  familyOptions,
  funderWords,
  grantorWords,
  groupBody,
  groupChanged,
  groupDraftFrom,
  incentiveWords,
  KEEP_GROUPS,
  lastChangeWords,
  needsGroupWords,
  NO_GROUP,
  offersNoGroup,
  parseShow,
  programsChanged,
  programWords,
  readDraft,
  shownSources,
  sourcesCsvName,
  whoPaidWords,
} from './sourcesModel'

const [FUNDED_A, , NEEDS_E] = FUNDING_SOURCES_2027.sources
if (FUNDED_A === undefined || NEEDS_E === undefined) throw new Error('fixture')

describe('the registry in words', () => {
  it('says who paid and incentive or need-based from the server’s facts (D88)', () => {
    expect(whoPaidWords(REG_CAMP_SUMMER)).toBe('This camp')
    expect(whoPaidWords(REG_GRANTOR_A_GRANT)).toBe('Another funder')
    expect(whoPaidWords(REG_UNCLASSIFIED)).toBe('')
    expect(incentiveWords(REG_GRANTOR_A_GRANT)).toBe('incentive')
    expect(incentiveWords(REG_GRANTOR_E_NEW)).toBe('need-based')
    expect(incentiveWords(REG_UNCLASSIFIED)).toBe('')
  })

  it("names programs in the rules' words, a key the rules don't name spelled out", () => {
    expect(programWords(['summer', 'family_camp'], { summer: 'Summer Sessions' })).toBe(
      'Summer Sessions, Family camp'
    )
    expect(funderWords('outside')).toBe('Outside grant')
    expect(funderWords('')).toBe('')
  })

  it('says the last change as who · when · "why", and nothing when none is logged (D105)', () => {
    expect(lastChangeWords(REG_GRANTOR_A_GRANT.last_change)).toBe(
      'finance@example.com · Sep 30 · "funds weekend families too"'
    )
    expect(lastChangeWords({ by: 'dev@example.com', at: '2026-10-02T09:00:00Z', note: ' ' })).toBe(
      'dev@example.com · Oct 2'
    )
    // R3-11: 8 pm on Oct 2 in camp time is 03:00 UTC on Oct 3; staff read the camp's day.
    expect(lastChangeWords({ by: 'dev@example.com', at: '2026-10-03T03:00:00Z', note: '' })).toBe(
      'dev@example.com · Oct 2'
    )
    expect(lastChangeWords(null)).toBe('')
  })

  it('counts Needs a group both ways, as ruling H words it', () => {
    expect(needsGroupWords(SOURCES_2027.sources)).toBe('Needs a group 2 · 1 with lines this season')
  })

  it('offers the families the registry already uses, never "unclassified" (P-12)', () => {
    expect(familyOptions(SOURCES_2027.sources)).toEqual([
      'camp_fa',
      'named_fund',
      'other_outside',
      'placeholder',
    ])
  })

  it('lets only an outside or incentive description name a grantor (the route’s rule)', () => {
    expect(canNameGrantor(REG_GRANTOR_A_GRANT)).toBe(true)
    expect(canNameGrantor(REG_CAMP_SUMMER)).toBe(false)
    expect(canNameGrantor(REG_UNCLASSIFIED)).toBe(false)
    expect(grantorWords(REG_GRANTOR_A_GRANT)).toBe('Grantor A')
    expect(grantorWords({ ...REG_GRANTOR_A_GRANT, grantor_name: '' })).toBe('grantor_a')
  })
})

describe('the chips and the CSV name', () => {
  it('reads ?show= and keeps the rows each chip names', () => {
    expect(parseShow('needs-group')).toBe('needs-group')
    expect(parseShow('unclassified')).toBe('unclassified')
    expect(parseShow('bogus')).toBe('all')
    expect(shownSources(SOURCES_2027.sources, 'needs-group').map((r) => r.id)).toEqual([
      'srcgrantorc0004',
      'srcgrantore0005',
    ])
    expect(shownSources(SOURCES_2027.sources, 'unclassified')).toEqual([REG_UNCLASSIFIED])
    expect(sourcesCsvName(2027, 'needs-group')).toBe(
      'camperships-money-sources-needs-group-2027.csv'
    )
  })
})

describe('the classification edit (P-12)', () => {
  it('starts from the row, an unclassified one with nothing picked, and an empty note', () => {
    expect(draftFrom(REG_UNCLASSIFIED)).toMatchObject({ family: '', funder: '', note: '' })
    expect(draftFrom(REG_NOT_AID)).toMatchObject({ family: 'placeholder', countsAsAid: false })
  })

  it('sends the whole classification with its note', () => {
    expect(
      readDraft({ ...draftFrom(REG_GRANTOR_A_GRANT), note: 'Funds weekend families too' })
    ).toEqual({
      ok: true,
      body: {
        source_name: 'Grantor A',
        source_family: 'other_outside',
        funder_type: 'outside',
        counts_as_aid: true,
        counts_toward_budget: false,
        implied_program_families: ['summer'],
        note: 'Funds weekend families too',
      },
    })
  })

  it('says what is missing before anything is sent', () => {
    expect(readDraft({ ...draftFrom(REG_UNCLASSIFIED), note: 'x' })).toEqual({
      ok: false,
      problem: 'Name the source',
    })
    expect(readDraft({ ...draftFrom(REG_UNCLASSIFIED), name: 'Bonus', note: 'x' })).toEqual({
      ok: false,
      problem: 'Pick its family',
    })
    expect(
      readDraft({
        ...draftFrom(REG_UNCLASSIFIED),
        name: 'Bonus',
        family: 'other_outside',
        note: 'x',
      })
    ).toEqual({ ok: false, problem: 'Pick who funds it' })
    expect(readDraft(draftFrom(REG_GRANTOR_A_GRANT))).toEqual({
      ok: false,
      problem: 'A note is required (it is logged)',
    })
  })

  it("says before sending what the route's budget rule refuses", () => {
    expect(
      readDraft({ ...draftFrom(REG_GRANTOR_A_GRANT), countsTowardBudget: true, note: 'x' })
    ).toEqual({ ok: false, problem: "Only the camp's own aid counts toward the budget" })
    expect(readDraft({ ...draftFrom(REG_CAMP_SUMMER), countsAsAid: false, note: 'x' })).toEqual({
      ok: false,
      problem: 'Counting toward the budget needs it to count as aid',
    })
  })

  it('knows when a classification drops the grantor in the same write', () => {
    expect(
      dropsGrantor(REG_GRANTOR_A_GRANT, { ...draftFrom(REG_GRANTOR_A_GRANT), funder: 'camp' })
    ).toBe(true)
    expect(dropsGrantor(REG_GRANTOR_A_GRANT, draftFrom(REG_GRANTOR_A_GRANT))).toBe(false)
    expect(
      dropsGrantor(REG_GRANTOR_E_NEW, { ...draftFrom(REG_GRANTOR_E_NEW), funder: 'camp' })
    ).toBe(false)
  })

  it('knows when the programs moved, in any order', () => {
    const draft = draftFrom(REG_GRANTOR_A_GRANT)
    expect(programsChanged(REG_GRANTOR_A_GRANT, draft)).toBe(false)
    expect(
      programsChanged(REG_GRANTOR_A_GRANT, { ...draft, programs: ['summer', 'family_camp'] })
    ).toBe(true)
  })
})

describe('Set a Group… (P-14; D159)', () => {
  it('starts from the group as shown, and keeps several pools unless one is picked', () => {
    expect(groupDraftFrom(FUNDED_A)).toEqual({ group: 'pool_a', incentive: true, note: '' })
    expect(groupDraftFrom(NEEDS_E)).toEqual({ group: NO_GROUP, incentive: false, note: '' })
    const several = { ...FUNDED_A, group: null, group_label: 'several groups' }
    expect(groupDraftFrom(several).group).toBe(KEEP_GROUPS)
  })

  it('sends one pool, an explicit null to clear, or no group at all to keep them', () => {
    expect(groupBody({ group: 'pool_b', incentive: false, note: ' New pool ' })).toEqual({
      group: 'pool_b',
      incentive: false,
      note: 'New pool',
    })
    expect(groupBody({ group: NO_GROUP, incentive: true, note: '' })).toEqual({
      group: null,
      incentive: true,
    })
    expect(groupBody({ group: KEEP_GROUPS, incentive: true, note: '' })).toEqual({
      incentive: true,
    })
  })

  it("offers no 'no group' for a source over several pools: the route would keep them (R3-7)", () => {
    expect(offersNoGroup(FUNDED_A)).toBe(true)
    expect(offersNoGroup(NEEDS_E)).toBe(true)
    expect(offersNoGroup({ ...FUNDED_A, group: null, group_label: 'several groups' })).toBe(false)
  })

  it('knows when the group itself moves (the warning shows then)', () => {
    expect(groupChanged(FUNDED_A, groupDraftFrom(FUNDED_A))).toBe(false)
    expect(groupChanged(FUNDED_A, { ...groupDraftFrom(FUNDED_A), group: NO_GROUP })).toBe(true)
    expect(groupChanged(NEEDS_E, { ...groupDraftFrom(NEEDS_E), group: 'pool_a' })).toBe(true)
  })
})
