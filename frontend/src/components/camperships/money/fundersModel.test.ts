/**
 * Money › Funders' model (owner 10-08, mock q2): the sources and the grantors merged into one flat
 * list grouped by who pays: Camp first, each funder A→Z with its descriptions under it, "No funder
 * yet" last. Pure. Invented rows only (registryFixtures, grantorDirectoryFixtures).
 */
import { describe, expect, it } from 'vitest'

import type { ApiAidSourceRow } from '../../../types/api-types'
import { GRANTOR_A, GRANTOR_C, GRANTOR_K, GRANTORS_ALL } from '../grants/grantorDirectoryFixtures'
import {
  buildFunders,
  funderHeaderWords,
  funderIdOfParam,
  funderParamOfId,
  funderSearchExtra,
  funderTerms,
  noFunderWords,
  switcherOptions,
  parseFundersShow,
  campWords,
  sourceFamilyWords,
  yesNo,
  yesNoWords,
  type FunderRow,
} from './fundersModel'
import {
  GRANTOR_C_PROGRAM,
  REG_CAMP_SUMMER,
  REG_GRANTOR_A_GRANT,
  REG_GRANTOR_E_NEW,
  REG_NOT_AID,
  REG_UNCLASSIFIED,
  SOURCES_2027,
} from './registryFixtures'

const ALL = { sources: SOURCES_2027.sources, grantors: GRANTORS_ALL.grantors }
const ids = (rows: readonly FunderRow[]) => rows.map((r) => r.id)
const head = (rows: readonly FunderRow[], id: string) => {
  const row = rows.find((r) => r.id === id)
  if (row?.kind !== 'funder') throw new Error(`no header ${id}`)
  return row
}

describe('buildFunders: grouping and order', () => {
  it('runs Camp first, each active funder A to Z with its descriptions, then No funder yet', () => {
    const { rows } = buildFunders({ ...ALL, show: 'all', showRetired: false })
    expect(ids(rows)).toEqual([
      'group:camp',
      REG_CAMP_SUMMER.id,
      REG_NOT_AID.id,
      'funder:grantor_a',
      REG_GRANTOR_A_GRANT.id,
      'funder:grantor_c',
      GRANTOR_C_PROGRAM.id,
      'funder:grantor_e',
      'funder:grantor_e:empty',
      'funder:grantor_k',
      'funder:grantor_k:empty',
      'group:none',
      REG_GRANTOR_E_NEW.id,
      REG_UNCLASSIFIED.id,
    ])
  })

  it('hides retired funders until asked, then lists them in their A to Z place, marked retired', () => {
    const hidden = buildFunders({ ...ALL, show: 'all', showRetired: false }).rows
    expect(ids(hidden)).not.toContain('funder:grantor_f')
    const shown = buildFunders({ ...ALL, show: 'all', showRetired: true }).rows
    const order = ids(shown).filter((id) => id.startsWith('funder:') && !id.endsWith(':empty'))
    expect(order).toEqual([
      'funder:grantor_a',
      'funder:grantor_c',
      'funder:grantor_e',
      'funder:grantor_f',
      'funder:grantor_k',
    ])
    expect(head(shown, 'funder:grantor_f').retired).toBe(true)
    expect(head(shown, 'funder:grantor_a').retired).toBe(false)
  })

  it('sends a description whose funder is hidden or unknown to No funder yet', () => {
    const toRetired: ApiAidSourceRow = { ...REG_GRANTOR_A_GRANT, grantor_key: 'grantor_f' }
    const toUnknown: ApiAidSourceRow = { ...GRANTOR_C_PROGRAM, grantor_key: 'grantor_zz' }
    const sources = [REG_CAMP_SUMMER, toRetired, toUnknown]
    const hidden = buildFunders({
      sources,
      grantors: GRANTORS_ALL.grantors,
      show: 'all',
      showRetired: false,
    })
    expect(head(hidden.rows, 'group:none').descriptions.map((d) => d.id)).toEqual([
      toRetired.id,
      toUnknown.id,
    ])
    // Shown, the retired funder holds its own description again.
    const shown = buildFunders({
      sources,
      grantors: GRANTORS_ALL.grantors,
      show: 'all',
      showRetired: true,
    })
    expect(head(shown.rows, 'funder:grantor_f').descriptions.map((d) => d.id)).toEqual([
      toRetired.id,
    ])
  })

  it('leaves out an empty Camp or No funder yet group', () => {
    const { rows } = buildFunders({
      sources: [REG_GRANTOR_A_GRANT],
      grantors: GRANTORS_ALL.grantors,
      show: 'all',
      showRetired: false,
    })
    expect(ids(rows)).not.toContain('group:camp')
    expect(ids(rows)).not.toContain('group:none')
  })

  it('puts a funder with no description under a muted "nothing yet" row', () => {
    const { rows } = buildFunders({ ...ALL, show: 'all', showRetired: false })
    const empty = rows.find((r) => r.id === 'funder:grantor_k:empty')
    expect(empty).toMatchObject({ kind: 'empty', funderId: 'funder:grantor_k' })
  })
})

describe('buildFunders: totals', () => {
  it("a funder's header holds the grantor's season lines and $; none yields 0 and no dollars", () => {
    const { rows } = buildFunders({ ...ALL, show: 'all', showRetired: false })
    expect(head(rows, 'funder:grantor_a')).toMatchObject({ lines: 61, amount: 44100 })
    expect(head(rows, 'funder:grantor_e')).toMatchObject({ lines: 0, amount: null })
  })

  it("Camp and No funder yet add up their descriptions' lines and $", () => {
    const { rows } = buildFunders({ ...ALL, show: 'all', showRetired: false })
    expect(head(rows, 'group:camp')).toMatchObject({ lines: 612 + 30, amount: 541200 + 9000 })
    expect(head(rows, 'group:none')).toMatchObject({ lines: 4 + 2, amount: 3200 + 400 })
  })

  it('a grantor read without a season shows no totals', () => {
    const { rows } = buildFunders({
      sources: [REG_GRANTOR_A_GRANT],
      grantors: [{ ...GRANTOR_A, season: null }],
      show: 'all',
      showRetired: false,
    })
    expect(head(rows, 'funder:grantor_a')).toMatchObject({ lines: null, amount: null })
  })
})

describe('buildFunders: chips', () => {
  it('counts funders (Camp included), descriptions, needs a group and no funder yet', () => {
    const { counts } = buildFunders({ ...ALL, show: 'all', showRetired: false })
    expect(counts).toEqual({ funders: 5, descriptions: 6, noFunder: 2 })
    // Final UX (§18, owner "shorten the filter choices"): the switcher says "All 5 · Needs a group 2 ·
    // No funder yet 2" and keeps the long words in each choice's title. It replaces the chip words, which put
    // "· 6 descriptions" and "· 1 with lines this season" on the buttons.
    expect(switcherOptions(counts, SOURCES_2027.sources)).toEqual([
      { value: 'all', label: 'All', count: 5, title: 'All 5 funders · 6 descriptions' },
      {
        value: 'needs-group',
        label: 'Needs a group',
        count: 2,
        title: '2 outside sources with no group · 1 with lines this season',
      },
      {
        value: 'no-funder',
        label: 'No funder yet',
        count: 2,
        title: '2 descriptions no funder claims yet',
      },
    ])
  })

  // Final audit: with no funder yet the count would read a bare 0 over a table of descriptions.
  it('words the All choice out when there are descriptions and no funder yet', () => {
    const [all] = switcherOptions({ funders: 0, descriptions: 28, noFunder: 28 }, [])
    expect(all).toEqual({
      value: 'all',
      label: 'All 0 funders · 28 descriptions',
      title: 'All 0 funders · 28 descriptions',
    })
    // Nothing at all keeps the plain chip and its 0.
    const [empty] = switcherOptions({ funders: 0, descriptions: 0, noFunder: 0 }, [])
    expect(empty).toMatchObject({ label: 'All', count: 0 })
  })

  it('counts a retired funder once it is shown', () => {
    const { counts } = buildFunders({ ...ALL, show: 'all', showRetired: true })
    expect(counts.funders).toBe(6)
  })

  it('says one funder and one description in the singular', () => {
    const [all, , none] = switcherOptions({ funders: 1, descriptions: 1, noFunder: 1 }, [])
    expect(all?.title).toBe('All 1 funder · 1 description')
    expect(none?.title).toBe('1 description no funder claims yet')
  })

  it('the counts do not move with the chip chosen', () => {
    const all = buildFunders({ ...ALL, show: 'all', showRetired: false }).counts
    expect(buildFunders({ ...ALL, show: 'needs-group', showRetired: false }).counts).toEqual(all)
    expect(buildFunders({ ...ALL, show: 'no-funder', showRetired: false }).counts).toEqual(all)
  })
})

describe('buildFunders: the chips filter', () => {
  it('Needs a group keeps those descriptions under their headers, totals unchanged', () => {
    const { rows } = buildFunders({ ...ALL, show: 'needs-group', showRetired: false })
    expect(ids(rows)).toEqual([
      'funder:grantor_c',
      GRANTOR_C_PROGRAM.id,
      'group:none',
      REG_GRANTOR_E_NEW.id,
    ])
    expect(head(rows, 'funder:grantor_c').lines).toBe(4)
  })

  it('No funder yet keeps that group alone', () => {
    const { rows } = buildFunders({ ...ALL, show: 'no-funder', showRetired: false })
    expect(ids(rows)).toEqual(['group:none', REG_GRANTOR_E_NEW.id, REG_UNCLASSIFIED.id])
  })

  it('parses ?show=', () => {
    expect(parseFundersShow(null)).toBe('all')
    expect(parseFundersShow('needs-group')).toBe('needs-group')
    expect(parseFundersShow('no-funder')).toBe('no-funder')
    expect(parseFundersShow('unclassified')).toBe('all')
    expect(parseFundersShow('nonsense')).toBe('all')
  })
})

describe('header words', () => {
  it("says a plain funder's terms, a full-coverage one's, and a named fund's", () => {
    expect(funderTerms(GRANTOR_A)).toBe('Not full coverage')
    expect(funderTerms(GRANTOR_C)).toBe(
      'Full coverage · covers canteen: not known · pays after camp aid: no'
    )
    expect(funderTerms({ ...GRANTOR_C, covers_canteen: 'yes' })).toBe(
      'Full coverage · covers canteen: yes · pays after camp aid: no'
    )
    expect(funderTerms(GRANTOR_K)).toBe(
      'Named fund · Full coverage · covers canteen: no · pays after camp aid: yes'
    )
  })

  it('says eligibility and the contact count, muted', () => {
    expect(funderHeaderWords(GRANTOR_A)).toEqual({
      terms: 'Not full coverage',
      detail: 'eligibility: First and second summers · 1 contact',
    })
    expect(funderHeaderWords(GRANTOR_K).detail).toBe(
      'eligibility: Fills the gap last · no contacts'
    )
    const two = {
      ...GRANTOR_A,
      eligibility: '',
      contacts: 'Test User, a@example.com\nOther User, 555-0101',
    }
    expect(funderHeaderWords(two).detail).toBe('2 contacts')
  })

  it("says Camp's and No funder yet's own words, with the description count muted beside them", () => {
    // Final UX (money-funders.html): the header's terms and its muted details are two runs, so the cell can
    // set the details in muted ink and cut at the totals.
    expect(campWords(3)).toEqual({
      terms: "The camp's own aid · counts toward the budget",
      detail: 'no terms or contacts · 3 descriptions',
    })
    expect(campWords(1).detail).toMatch(/· 1 description$/)
    expect(noFunderWords(2, true, true)).toEqual({
      terms: "Pick each description's funder; classify an unclassified one first",
      detail: '2 descriptions',
    })
    expect(noFunderWords(2, false, true).terms).toBe("Pick each description's funder")
    // Final audit O10: someone who cannot pick a funder is not told to; the line only says what is here.
    expect(noFunderWords(2, false, false)).toEqual({
      terms: 'Descriptions no funder claims yet',
      detail: '2 descriptions',
    })
    expect(noFunderWords(1, true, false).detail).toBe('1 description')
  })
})

describe('cells', () => {
  it('says a dash for a false yes or no (final audit O9)', () => {
    expect(yesNo(true)).toBe('yes')
    expect(yesNo(false)).toBe('—')
  })

  it('keeps yes and no in words for the CSV and the search', () => {
    expect(yesNoWords(true)).toBe('yes')
    expect(yesNoWords(false)).toBe('no')
  })

  it('shows the server source-family label when the row has one, else the old words, never a raw key', () => {
    expect(sourceFamilyWords(REG_GRANTOR_A_GRANT)).toBe('other outside')
    // The back end adds the property; it is not in the generated types yet.
    const labelled = (value: unknown) =>
      ({ ...REG_GRANTOR_A_GRANT, source_family_label: value }) as ApiAidSourceRow
    expect(sourceFamilyWords(labelled('Other outside grants'))).toBe('Other outside grants')
    expect(sourceFamilyWords(labelled(''))).toBe('other outside')
    expect(sourceFamilyWords(labelled(7))).toBe('other outside')
    expect(sourceFamilyWords(REG_UNCLASSIFIED)).toBe('')
  })
})

describe('search extras', () => {
  const { rows } = buildFunders({ ...ALL, show: 'all', showRetired: false })
  const extra = (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (row === undefined) throw new Error(id)
    return funderSearchExtra(row)
  }

  it("a description also matches on its funder's name", () => {
    expect(extra(REG_GRANTOR_A_GRANT.id)).toContain('Grantor A')
  })

  it("a header matches on its descriptions and the funder's aliases", () => {
    expect(extra('funder:grantor_a')).toEqual(
      expect.arrayContaining(['Grantor A grant', 'Grantor A program'])
    )
    expect(extra('group:camp')).toEqual(
      expect.arrayContaining(['Camp aid · Summer', 'Sibling discount'])
    )
  })

  it('an empty-funder row matches on its funder', () => {
    expect(extra('funder:grantor_k:empty')).toContain('Grantor K gap-filler award')
  })
})

describe('the ?funder= value', () => {
  it('names a funder row by its key, and a group or an empty row by its own id', () => {
    expect(funderParamOfId('funder:grantor_a')).toBe('grantor_a')
    expect(funderParamOfId('funder:grantor_a:empty')).toBe('grantor_a:empty')
    expect(funderParamOfId('group:camp')).toBe('group:camp')
  })

  it('reads one back, so a link made by hand or by the old Grantors page still opens its row', () => {
    for (const id of ['funder:grantor_a', 'funder:grantor_a:empty', 'group:none']) {
      expect(funderIdOfParam(funderParamOfId(id))).toBe(id)
    }
    expect(funderIdOfParam('grantor_k')).toBe('funder:grantor_k')
  })
})
