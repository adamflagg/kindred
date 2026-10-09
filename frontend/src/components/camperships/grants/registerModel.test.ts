/** Grants › Register's words and total (§8.2; D55, D126, D142; rulings D and G; P-15). */
import { describe, expect, it } from 'vitest'

import {
  EMMA_GRANT,
  GARCIA_HOUSEHOLD,
  GRANTS,
  LIAM_SOLE_CAMPER,
  NEVER_APPLIED_HOUSEHOLD,
  OLIVIA_AFTER_OFFER,
  OLIVIA_REVERSED,
  RILEY_COMMITMENT,
  SAMUEL_CANCELLED,
  SAMUEL_POSTED_CANCELLED,
  grantRow,
} from './grantsFixtures'
import {
  basisWords,
  camperWords,
  registerTotal,
  countsInTotal,
  programCsv,
  programWords,
  funderLink,
  REGISTER_TOTAL_NOTE,
  didntApply,
  footerWords,
  neverAppliedNote,
  grantKey,
  isAfterOffer,
  needsCamperIds,
  offsetWords,
  registerFamily,
  shareWords,
  standingCsv,
  standingNote,
  standingWords,
} from './registerModel'

const NEEDS = needsCamperIds(GRANTS.needs_camper)

describe('a Register row in words', () => {
  it('keys a line by its transaction and a commitment by its id', () => {
    expect(grantKey(EMMA_GRANT)).toBe('t4000001')
    expect(grantKey(RILEY_COMMITMENT)).toBe('ccmtriley0000001')
  })

  it("names the family by the household card's label, else the family name (ruling D)", () => {
    expect(registerFamily(GARCIA_HOUSEHOLD)).toEqual({ text: 'Pat Garcia', tiebreak: '' })
    expect(registerFamily({ ...GARCIA_HOUSEHOLD, label_tiebreak: '#1000002' })).toEqual({
      text: 'Pat Garcia',
      tiebreak: '#1000002',
    })
    expect(registerFamily(EMMA_GRANT)).toEqual({ text: 'Johnson', tiebreak: '' })
  })

  it("names the camper, or why there is none, from the read's needs-a-camper set (D126, D142)", () => {
    expect(camperWords(EMMA_GRANT)).toBe('Emma Johnson')
    expect(camperWords(GARCIA_HOUSEHOLD)).toBe('household level')
    expect(basisWords(GARCIA_HOUSEHOLD, NEEDS)).toBe('needs a camper')
    expect(basisWords(GARCIA_HOUSEHOLD, new Set())).toBe('stays at household level')
    expect(basisWords(LIAM_SOLE_CAMPER, NEEDS)).toBe("tied by rule: the household's one camper")
    expect(basisWords(EMMA_GRANT, NEEDS)).toBe('')
  })

  it('says where it stands: in CampMinder, reversed, or committed by hand (D55, D74)', () => {
    expect(standingWords(EMMA_GRANT)).toBe('in CampMinder · Mar 12')
    expect(standingWords(OLIVIA_REVERSED)).toBe('in CampMinder · Mar 12 · reversed Apr 1')
    expect(standingWords(RILEY_COMMITMENT)).toBe('committed · not yet in CampMinder')
    expect(standingNote(RILEY_COMMITMENT)).toBe('committed Apr 2 · entered by hand')
    expect(standingNote(EMMA_GRANT)).toBe('')
    // grants-v2.html (the 10-08 filter mock, R5-1): a late line says so under where it stands.
    expect(standingNote(OLIVIA_AFTER_OFFER)).toBe('after the offer · extra for the family')
    expect(standingCsv(RILEY_COMMITMENT)).toBe(
      'committed · not yet in CampMinder · committed Apr 2 · entered by hand'
    )
  })
})

describe('the aid request it offsets (#2975: requests[].offsets/round/round_amount)', () => {
  it('names the round and its amount now, or why no round counts it', () => {
    expect(offsetWords(EMMA_GRANT, NEEDS)).toBe('R1 $1,420')
    expect(offsetWords(RILEY_COMMITMENT, NEEDS)).toBe('R1 $0')
    expect(offsetWords(OLIVIA_AFTER_OFFER, NEEDS)).toBe('after the offer')
    expect(
      shareWords({ request_id: 'r', amount: 500, offsets: 'round', round: 2, round_amount: null })
    ).toBe('R2 · not decided yet')
    expect(shareWords({ request_id: 'r', amount: 500, offsets: 'not_offset_program' })).toBe(
      "the program doesn't subtract grants"
    )
    // The stored-fields read carries no round: the share's own amount, said plainly.
    expect(shareWords({ request_id: 'r', amount: 500 })).toBe('$500 on the request')
  })

  it('says "didn\'t apply" for a family with no request, and "applied · no camper yet" for a waiting line', () => {
    expect(offsetWords(LIAM_SOLE_CAMPER, NEEDS)).toBe("didn't apply")
    expect(didntApply(LIAM_SOLE_CAMPER, NEEDS)).toBe(true)
    // R5-2: a never-applied household's line that stays at household level is one too, though the
    // server doesn't count it; it is not in needs_camper (applied households only).
    expect(didntApply(NEVER_APPLIED_HOUSEHOLD, NEEDS)).toBe(true)
    expect(offsetWords(NEVER_APPLIED_HOUSEHOLD, NEEDS)).toBe("didn't apply")
    expect(basisWords(NEVER_APPLIED_HOUSEHOLD, NEEDS)).toBe('stays at household level')
    // Ruled edit (owner, spec §8.2): a never-applied household's line now counts.
    expect(registerTotal([NEVER_APPLIED_HOUSEHOLD], NEEDS)).toBe(900)
    expect(
      [GARCIA_HOUSEHOLD, OLIVIA_REVERSED, SAMUEL_CANCELLED].some((row) => didntApply(row, NEEDS))
    ).toBe(false)
    expect(offsetWords(GARCIA_HOUSEHOLD, NEEDS)).toBe('applied · no camper yet')
    expect(offsetWords(OLIVIA_REVERSED, NEEDS)).toBe('—')
    expect(offsetWords(SAMUEL_CANCELLED, NEEDS)).toBe('—')
  })

  it('joins a grant split over two requests share by share', () => {
    const split = grantRow({
      transaction_cm_id: 4000011,
      requests: [
        { request_id: 'a', amount: 350, offsets: 'round', round: 1, round_amount: 1420 },
        { request_id: 'b', amount: 350, offsets: 'after_offer' },
      ],
    })
    expect(offsetWords(split, NEEDS)).toBe('R1 $1,420 · after the offer')
  })

  it('marks a grant known after the offer on any of its requests (ruling G)', () => {
    expect(isAfterOffer(OLIVIA_AFTER_OFFER)).toBe(true)
    expect(GRANTS.grants.filter(isAfterOffer)).toEqual([OLIVIA_AFTER_OFFER])
  })
})

describe('the total and the footer (⚠ P-15, review item 9)', () => {
  it('⚠ totals only the rows the server counts, and says how many it leaves out', () => {
    expect(registerTotal(GRANTS.grants, NEEDS)).toBe(10200)
    // Out: a reversed line, a cancelled camper's commitment, a line waiting for its camper.
    expect(registerTotal([OLIVIA_REVERSED, SAMUEL_CANCELLED, GARCIA_HOUSEHOLD], NEEDS)).toBe(0)
    // In: a posted grant for a cancelled camper, until CampMinder reverses it.
    expect(registerTotal([SAMUEL_POSTED_CANCELLED], NEEDS)).toBe(1500)
    expect(footerWords(GRANTS.grants, NEEDS)).toBe('8 grants · 3 not counted')
    expect(footerWords([EMMA_GRANT], NEEDS)).toBe('1 grant')
  })

  it('adds cents exactly', () => {
    expect(
      registerTotal(
        [
          grantRow({ transaction_cm_id: 1, amount: 0.1 }),
          grantRow({ transaction_cm_id: 2, amount: 0.2 }),
        ],
        NEEDS
      )
    ).toBe(0.3)
  })
})

describe("⚠ the Register total counts a never-applied household's lines (owner, spec §8.2)", () => {
  it('counts a household-level line of a family that never applied, though the server does not', () => {
    expect(NEVER_APPLIED_HOUSEHOLD.counts).toBe(false)
    expect(countsInTotal(NEVER_APPLIED_HOUSEHOLD, NEEDS)).toBe(true)
    expect(registerTotal([...GRANTS.grants, NEVER_APPLIED_HOUSEHOLD], NEEDS)).toBe(11100)
  })

  it('still leaves out a waiting line, a reversed line and a cancelled commitment', () => {
    for (const row of [GARCIA_HOUSEHOLD, OLIVIA_REVERSED, SAMUEL_CANCELLED]) {
      expect(countsInTotal(row, NEEDS)).toBe(false)
    }
  })

  it('footer: "not counted" excludes the didn\'t-apply rows', () => {
    expect(footerWords([...GRANTS.grants, NEVER_APPLIED_HOUSEHOLD], NEEDS)).toBe(
      '9 grants · 3 not counted'
    )
  })

  it('the note says a household-level line of a family that did not apply counts', () => {
    expect(REGISTER_TOTAL_NOTE).toMatch(
      /so does a household-level line of a family that didn.t apply/
    )
  })
})

describe('the Program column (program_label, #3090; #3085 fallbacks)', () => {
  it("uses the server's label", () => {
    expect(programWords(EMMA_GRANT)).toBe('Summer Camp')
  })
  it('falls back to a dash with no program (the Camper cell says household level), else Other program; never a key', () => {
    // Final audit E18: grants-v2 draws "—", and the Camper cell already says "Household level · needs a camper".
    expect(programWords(NEVER_APPLIED_HOUSEHOLD)).toBe('—')
    expect(programWords(GARCIA_HOUSEHOLD)).toBe('—')
    expect(programWords({ ...EMMA_GRANT, program_label: '', program_family: 'quest' })).toBe(
      'Other program'
    )
  })
})

describe('the Program CSV and search words', () => {
  it('keep Household level and Not placed where the screen says a dash', () => {
    const needs = new Set([NEVER_APPLIED_HOUSEHOLD.transaction_cm_id])
    expect(programCsv(NEVER_APPLIED_HOUSEHOLD, needs)).toBe('Not placed')
    expect(programCsv(NEVER_APPLIED_HOUSEHOLD, new Set())).toBe('Household level')
    expect(programCsv(EMMA_GRANT, needs)).toBe('Summer Camp')
    expect(programCsv({ ...EMMA_GRANT, program_label: '', program_family: 'quest' }, needs)).toBe(
      'Other program'
    )
  })
})

describe('where a Register row links in Funders', () => {
  it('a mapped grantor by its key; an unmapped description by its source id', () => {
    expect(funderLink(EMMA_GRANT, GRANTS.unmapped)).toEqual({ param: 'funder', value: 'grantor_a' })
    expect(funderLink(OLIVIA_AFTER_OFFER, GRANTS.unmapped)).toEqual({
      param: 'row',
      value: 'srcgrantore0005',
    })
    expect(funderLink({ ...OLIVIA_AFTER_OFFER, description: 'zzz' }, GRANTS.unmapped)).toBeNull()
  })
})

describe('neverAppliedNote (final audit E15)', () => {
  it('says how many household-level lines of families who did not apply the total counts, and their sum', () => {
    expect(neverAppliedNote([...GRANTS.grants, NEVER_APPLIED_HOUSEHOLD], NEEDS)).toBe(
      "counts 1 household-level line of families who didn't apply ($900)"
    )
    expect(
      neverAppliedNote(
        [
          NEVER_APPLIED_HOUSEHOLD,
          { ...NEVER_APPLIED_HOUSEHOLD, transaction_cm_id: 4000099, amount: 100.5 },
        ],
        NEEDS
      )
    ).toBe("counts 2 household-level lines of families who didn't apply ($1,000.50)")
  })
  it('says nothing when none are in view', () => {
    expect(neverAppliedNote(GRANTS.grants, NEEDS)).toBe('')
  })
})
