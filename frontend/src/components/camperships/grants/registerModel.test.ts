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
  didntApply,
  footerWords,
  neverAppliedNote,
  neverAppliedShort,
  notCountedWhy,
  offsetTitle,
  cmWords,
  postedTitle,
  committedTitle,
  openedStanding,
  cancelTitle,
  camperTitle,
  COMMITTED_CHIP,
  sessionWords,
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
    // money-grants.html: the session leads (aidSessionName), then the round.
    expect(offsetWords(EMMA_GRANT, NEEDS)).toBe('Session 2 · R1 $1,420')
    expect(offsetWords(RILEY_COMMITMENT, NEEDS)).toBe('Session 3 · R1 $0')
    expect(offsetWords(OLIVIA_AFTER_OFFER, NEEDS)).toBe('Quest · after the offer')
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
    expect(offsetWords(split, NEEDS)).toBe('Session 2 · R1 $1,420 · after the offer')
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

describe('neverAppliedNote (final audit E15; money-grants.html)', () => {
  it('says in full how many household-level lines of families who did not apply the total counts, and their sum', () => {
    expect(neverAppliedNote([...GRANTS.grants, NEVER_APPLIED_HOUSEHOLD], NEEDS)).toBe(
      "The total counts 1 household-level line of families who didn't apply ($900)"
    )
    expect(
      neverAppliedNote(
        [
          NEVER_APPLIED_HOUSEHOLD,
          { ...NEVER_APPLIED_HOUSEHOLD, transaction_cm_id: 4000099, amount: 100.5 },
        ],
        NEEDS
      )
    ).toBe("The total counts 2 household-level lines of families who didn't apply ($1,000.50)")
  })
  it('is "incl. $900 didn\'t apply" in the column\'s own footer cell (design-language §10)', () => {
    expect(neverAppliedShort([...GRANTS.grants, NEVER_APPLIED_HOUSEHOLD], NEEDS)).toBe(
      "incl. $900 didn't apply"
    )
  })
  it('says nothing when none are in view', () => {
    expect(neverAppliedNote(GRANTS.grants, NEEDS)).toBe('')
    expect(neverAppliedShort(GRANTS.grants, NEEDS)).toBe('')
  })
})

describe('one-line cells (money-grants.html; ★16, ★18, ruling 15)', () => {
  it("names why a line is not counted, in the mock's words (★16)", () => {
    expect(notCountedWhy(OLIVIA_REVERSED, NEEDS)).toBe('reversed')
    expect(notCountedWhy(GARCIA_HOUSEHOLD, NEEDS)).toBe('waiting for its camper')
    expect(notCountedWhy(SAMUEL_CANCELLED, NEEDS)).toBe('a commitment whose camper cancelled')
  })

  it('shortens a posted line to "in CM · Mar 12" and keeps the long words for the title (★18)', () => {
    expect(cmWords(EMMA_GRANT)).toBe('in CM · Mar 12')
    expect(cmWords(OLIVIA_REVERSED)).toBe('in CM · Mar 12 · reversed Apr 1')
    expect(postedTitle(EMMA_GRANT)).toBe('Posted in CampMinder Mar 12')
    expect(postedTitle({ ...EMMA_GRANT, fulfils_commitment_id: 'cmtx' })).toBe(
      'Posted in CampMinder Mar 12 · fulfils a commitment'
    )
    expect(postedTitle(OLIVIA_AFTER_OFFER)).toBe(
      'Posted in CampMinder May 2 · after the offer: extra for the family'
    )
    expect(postedTitle(OLIVIA_REVERSED)).toBe('Posted in CampMinder Mar 12 · reversed Apr 1')
  })

  it("reads a commitment's opened-row line in the mock's order: when, by hand, not yet in CampMinder", () => {
    expect(openedStanding(RILEY_COMMITMENT)).toBe(
      'committed Apr 2 · entered by hand · not yet in CampMinder'
    )
    expect(openedStanding(EMMA_GRANT)).toBe(standingCsv(EMMA_GRANT))
  })

  it('writes a commitment as one chip, its details in the title (★18)', () => {
    expect(COMMITTED_CHIP).toBe('Committed · not in CM')
    expect(committedTitle(RILEY_COMMITMENT)).toBe(
      'Committed Apr 2 · entered by hand · not yet posted in CampMinder'
    )
  })

  it('says a cancelled camper in a title that tells whether the line still counts (ruling 15)', () => {
    expect(cancelTitle(SAMUEL_POSTED_CANCELLED)).toBe(
      'The camper cancelled (from CampMinder enrollment): a posted grant still counts until CampMinder reverses it'
    )
    expect(cancelTitle(SAMUEL_CANCELLED)).toBe(
      "The camper cancelled (from CampMinder enrollment): the commitment isn't counted"
    )
  })

  it('titles the camper cell with the name, the cancellation and how the camper was found', () => {
    expect(camperTitle(EMMA_GRANT, NEEDS)).toBe('Emma Johnson')
    expect(camperTitle({ ...EMMA_GRANT, camper_basis: 'placed' }, NEEDS)).toBe(
      'Emma Johnson · placed by staff'
    )
    expect(camperTitle(SAMUEL_CANCELLED, NEEDS)).toBe(
      "Samuel Johnson · The camper cancelled (from CampMinder enrollment): the commitment isn't counted"
    )
    expect(camperTitle(GARCIA_HOUSEHOLD, NEEDS)).toBe('Household level · needs a camper')
  })

  it('shows a session in its short form and keeps the full name for the title', () => {
    expect(sessionWords(EMMA_GRANT)).toEqual({ short: 'Session 2', full: 'Session 2' })
    const fc = grantRow({
      transaction_cm_id: 1,
      person_cm_id: 0,
      camper_basis: 'household',
      session_name: 'Family Camp 1: Fall Weekend',
    })
    expect(sessionWords(fc)).toEqual({ short: 'FC1', full: 'Family Camp 1: Fall Weekend' })
    expect(sessionWords(GARCIA_HOUSEHOLD)).toEqual({ short: '', full: '' })
  })

  it("passes the row's session_type, so a name only the type can shorten is shortened", () => {
    // The type is what tells a weekend's adult program apart; by name alone it reads whole.
    const adult = grantRow({
      transaction_cm_id: 2,
      person_cm_id: 0,
      camper_basis: 'household',
      session_name: "Women's Weekend: Spring",
      session_type: 'adult',
    })
    expect(sessionWords(adult)).toEqual({
      short: "Women's Weekend",
      full: "Women's Weekend: Spring",
    })
    expect(sessionWords({ ...adult, session_type: '' }).short).toBe("Women's Weekend: Spring")
    // Teen and Quest names are their own short form: the type is passed and they read whole.
    const teen = grantRow({
      transaction_cm_id: 3,
      session_name: 'Teen Leadership Institute (TLI) 1',
      session_type: 'tli',
    })
    expect(sessionWords(teen).short).toBe('Teen Leadership Institute (TLI) 1')
  })

  it("titles the offsets cell with the full session and each share's part of the grant", () => {
    expect(offsetTitle(EMMA_GRANT, NEEDS)).toBe('Session 2 · R1 $1,420 · $700 of the grant')
    expect(offsetTitle(LIAM_SOLE_CAMPER, NEEDS)).toBe(
      'The family has no aid request this season: the grant counts, and offsets nothing'
    )
    expect(offsetTitle(OLIVIA_REVERSED, NEEDS)).toBe('A reversed line offsets nothing')
    expect(offsetTitle(SAMUEL_CANCELLED, NEEDS)).toBe('The camper cancelled: it offsets nothing')
    expect(offsetTitle(GARCIA_HOUSEHOLD, NEEDS)).toBe('Applied · waiting for its camper')
  })
})
