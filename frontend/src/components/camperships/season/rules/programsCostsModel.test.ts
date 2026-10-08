import { describe, expect, it } from 'vitest'

import type { ApiAidValidationIssue } from '../../../../types/api-types'
import { CATALOG, GROUPS, pcDoc } from './programsCostsFixtures'
import {
  agWords,
  buildContents,
  cardView,
  changesSince,
  editKey,
  fixWords,
  groupPill,
  kindFor,
  noGroupCount,
  noGroupPins,
  NOT_OPEN,
  pickTarget,
  pricePins,
  resolveProgram,
  type EditField,
} from './programsCostsModel'

const names = (rows: ReadonlyArray<{ session: { name: string } }>) =>
  rows.map((r) => r.session.name)
const view = (doc = pcDoc(), cancelled: ReadonlySet<number> = new Set()) =>
  cardView(doc, GROUPS, CATALOG, cancelled)

describe('cardView (spec §4.2–§4.4, §5.2)', () => {
  it('lays the groups out in pool order, sub-sections by date then CampMinder order, per-person rows last', () => {
    const [camp, weekend, school] = view().groups
    expect(names(camp?.running ?? [])).toEqual([
      'Starter Session',
      'Session 2',
      'Session 2b',
      'Winter Retreat',
      'Leader in Training',
    ])
    expect(camp?.subLabels).toBe(true)
    expect(names(weekend?.running ?? [])).toEqual([
      'Adult Weekend',
      'Family Camp A',
      'Family Camp B',
    ])
    expect(weekend?.subLabels).toBe(false)
    expect(names(school?.running ?? [])).toEqual(['Coming-of-Age Year 1'])
  })

  it('hides an AG session and counts it on its group, at its parent price', () => {
    const camp = view().groups[0]
    expect(names(camp?.running ?? [])).not.toContain('AG Session 2')
    expect(camp?.agCount).toBe(1)
  })

  it('folds a not-running session out of the running rows', () => {
    const camp = view().groups[0]
    expect(names(camp?.notRunning ?? [])).toEqual(['Quest: Rivers'])
  })

  it('drops an AG session from every count and fold when its parent is not running (Review Focus 1)', () => {
    const doc = pcDoc()
    doc.cost.not_running_session_cm_ids = [1000101]
    const camp = view(doc).groups[0]
    expect(camp?.agCount).toBe(0)
    expect(names([...(camp?.running ?? []), ...(camp?.notRunning ?? [])])).not.toContain(
      'AG Session 2'
    )
    expect(names(view(doc).notOpen)).not.toContain('AG Session 2')
  })

  it('puts a closed program, a pool-less program and an unclaimed session under Not open to aid', () => {
    expect(names(view().notOpen)).toEqual(['Staff Week', 'New Session Nobody Placed'])
    expect(view().notOpen.find((r) => r.session.cmId === 1000902)?.program).toBeNull()
  })

  it("reads each row's own prices, as stored", () => {
    const camp = view().groups[0]
    expect(camp?.running.find((r) => r.session.cmId === 1000101)?.tuition).toBe('6695.0')
    const fcA = view().groups[1]?.running.find((r) => r.session.cmId === 1000201)
    expect([fcA?.kind, fcA?.standard, fcA?.infant]).toEqual(['per_person', '425', '0'])
  })

  it('marks a legacy program with no Round 1 table "minimum only"', () => {
    expect(view().groups[1]?.running.find((r) => r.session.cmId === 1000401)?.minimumOnly).toBe(
      true
    )
  })

  it('tags the program only when its label says something the name and group do not', () => {
    const camp = view().groups[0]
    expect(camp?.running.find((r) => r.session.cmId === 1000110)?.tag).toBe('Teen Programs')
    expect(camp?.running.find((r) => r.session.cmId === 1000101)?.tag).toBeNull() // "Summer"
    expect(view().groups[1]?.running.find((r) => r.session.cmId === 1000401)?.tag).toBeNull() // in the name
    expect(view().groups[2]?.running.find((r) => r.session.cmId === 1000501)?.tag).toBeNull() // the group's name
  })

  it('marks a session the lodging board cancelled, without touching Not running', () => {
    const fcB = view(pcDoc(), new Set([1000202])).groups[1]?.running.find(
      (r) => r.session.cmId === 1000202
    )
    expect([fcB?.cancelledOnBoard, fcB?.notRunning]).toEqual([true, false])
  })

  it('resolves an explicit id before a type, as the server does', () => {
    const doc = pcDoc()
    doc.programs['summer'] = { ...doc.programs['summer']!, session_types: ['main'] }
    expect(resolveProgram(doc, 1000110, 'main')).toBe('teen')
    expect(resolveProgram(doc, 1000999, 'main')).toBe('summer')
    expect(resolveProgram(doc, 1000999, 'quest')).toBeNull()
  })

  it('resolves an AG session no program claims to its parent’s program, as the server does (Review Focus 6)', () => {
    const doc = pcDoc()
    doc.programs['summer'] = {
      ...doc.programs['summer']!,
      session_cm_ids: [1000101, 1000102, 1000104, 1000106, 1000107],
    }
    expect(resolveProgram(doc, 1000103, 'ag')).toBeNull()
    expect(resolveProgram(doc, 1000103, 'ag', { cmId: 1000101, type: 'main' })).toBe('summer')
    expect(resolveProgram(doc, 1000103, 'embedded', { cmId: 1000101, type: 'main' })).toBeNull()
    expect(view(doc).groups[0]?.agCount).toBe(1) // still counted on its parent's group
    expect(names(view(doc).notOpen)).not.toContain('AG Session 2') // never a row in Not open to aid
  })

  it('keeps a session whose group no longer exists under Not open to aid', () => {
    const doc = pcDoc()
    doc.programs['school'] = { ...doc.programs['school']!, budget_pool: 'gone' }
    expect(view(doc).notOpen.map((r) => r.group)).toContain(NOT_OPEN)
  })
})

const allRows = (v = view()) => [
  ...v.groups.flatMap((g) => [...g.running, ...g.notRunning]),
  ...v.notOpen,
]
const row = (cmId: number, v = view()) => allRows(v).find((r) => r.session.cmId === cmId)!
const save = (edits: Array<[number, EditField, string]>, doc = pcDoc()) =>
  buildContents(
    doc,
    cardView(doc, GROUPS, CATALOG, new Set()),
    CATALOG,
    new Map(edits.map(([id, f, v]) => [editKey(id, f), v]))
  )
const ok = (r: ReturnType<typeof save>) => {
  if (r.kind !== 'ok') throw new Error(r.words)
  return r
}
const programsOf = (r: ReturnType<typeof save>) =>
  ok(r).contents.programs as Record<string, unknown>
const costOf = (r: ReturnType<typeof save>) => ok(r).contents.cost as Record<string, unknown>
const ids = (programs: Record<string, unknown>, key: string) =>
  (programs[key] as { session_cm_ids: number[] }).session_cm_ids

describe('the pick rule (spec §4.5)', () => {
  it('keeps an open program’s kind, and gives one from Not open to aid its type’s kind', () => {
    expect(kindFor(row(1000201), pcDoc())).toBe('per_person')
    expect(kindFor(row(1000901), pcDoc())).toBe('catalog')
    const family = { ...row(1000902), session: { ...row(1000902).session, type: 'family' } }
    expect(kindFor(family, pcDoc())).toBe('per_person')
  })

  it('targets the open program of the group and kind that claims the most sessions, ties to document order', () => {
    expect(pickTarget(pcDoc(), 'camp_pool', 'catalog')).toBe('summer')
    expect(pickTarget(pcDoc(), 'weekend_pool', 'per_person')).toBe('family_camp')
    expect(pickTarget(pcDoc(), NOT_OPEN, 'catalog')).toBe('not_aided')
    expect(pickTarget(pcDoc(), 'school_pool', 'per_person')).toBeNull() // offered disabled: "(no program prices this kind here)"
  })
})

describe('buildContents (spec §4.5, §5.2 J, §6)', () => {
  it('moves a session: out of every program, into the target', () => {
    const programs = programsOf(save([[1000110, 'g', NOT_OPEN]]))
    expect(ids(programs, 'teen')).toEqual([])
    expect(ids(programs, 'not_aided')).toEqual([1000901, 1000110])
  })

  it('moves a session already listed in its target without duplicating it (Review Focus 2)', () => {
    const doc = pcDoc()
    doc.programs['not_aided']!.session_cm_ids = [1000901, 1000110] // drift: also listed where it is moving to
    const programs = programsOf(save([[1000110, 'g', NOT_OPEN]], doc))
    expect(ids(programs, 'not_aided').filter((id) => id === 1000110)).toHaveLength(1)
    expect(ids(programs, 'teen')).toEqual([])
    expect(ok(save([[1000101, 'g', 'camp_pool']])).contents).toEqual({}) // its own group again: nothing to send
  })

  it('writes every AG session into its parent’s program, whether or not the parent moved', () => {
    const programs = programsOf(save([[1000101, 'g', 'school_pool']]))
    expect(ids(programs, 'school')).toEqual(expect.arrayContaining([1000501, 1000101, 1000103]))
    expect(ids(programs, 'summer')).not.toContain(1000103)
  })

  it('writes a tuition as typed, and a blank removes it', () => {
    const tuition = costOf(
      save([
        [1000101, 't', '6,895'],
        [1000104, 't', ''],
      ])
    )['tuition'] as Record<string, string>
    expect(tuition['1000101']).toBe('6895')
    expect(tuition).not.toHaveProperty('1000104')
  })

  it('writes a per-person pair, $0 included, sorted by start date; both blank removes it', () => {
    const cost = costOf(
      save([
        [1000202, 's', '450'],
        [1000202, 'i', '0'],
        [1000201, 's', ''],
        [1000201, 'i', ''],
      ])
    )
    expect(cost['family_rates']).toEqual([{ session_cm_id: 1000202, standard: '450', infant: '0' }])
  })

  it('refuses a per-person pair with one box blank, naming the box', () => {
    expect(save([[1000202, 's', '450']])).toEqual({
      kind: 'invalid',
      words:
        'A per-person price needs both Standard and Infant ($0 is a real price). Fix the box marked in red.',
      boxes: [editKey(1000202, 'i')],
    })
  })

  it('counts the boxes in the fix line: one box, or n boxes', () => {
    expect([fixWords(1), fixWords(2)]).toEqual([
      'Fix the box marked in red.',
      'Fix the 2 boxes marked in red.',
    ])
    const pairs = save([
      [1000202, 's', '450'],
      [1000201, 'i', ''],
    ])
    expect(pairs.kind === 'invalid' && pairs.words).toBe(
      'A per-person price needs both Standard and Infant ($0 is a real price). Fix the 2 boxes marked in red.'
    )
    const money = save([
      [1000101, 't', '6895.555'],
      [1000104, 't', 'abc'],
    ])
    expect(money.kind === 'invalid' && money.words).toBe(
      'Type whole dollars. Fix the 2 boxes marked in red.'
    )
  })

  it('refuses a box that is not whole dollars or dollars and cents', () => {
    expect(save([[1000101, 't', '6895.555']])).toEqual({
      kind: 'invalid',
      words: 'Type whole dollars. Fix the box marked in red.',
      boxes: [editKey(1000101, 't')],
    })
  })

  it('checks and unchecks Not running, dropping duplicates', () => {
    const cost = costOf(
      save([
        [1000101, 'nr', 'true'],
        [1000106, 'nr', 'false'],
      ])
    )
    expect(cost['not_running_session_cm_ids']).toEqual([1000101])
  })

  it('leaves a not-running or moved session’s stored price as it is', () => {
    const out = ok(save([[1000106, 'g', NOT_OPEN]]))
    expect(out.contents.cost).toBeUndefined() // its tuition stays stored, so cost isn't sent
    expect(ids(out.contents.programs as Record<string, unknown>, 'not_aided')).toContain(1000106)
  })

  it('touches no other field', () => {
    const out = ok(save([[1000101, 't', '6895']]))
    expect(out.contents.programs).toBeUndefined()
    expect({ ...(out.contents.cost as object), tuition: null }).toEqual({
      ...pcDoc().cost,
      tuition: null,
    })
  })

  it('a groups-only Save sends programs alone and re-sorts no stored list (Review Focus 8)', () => {
    const doc = pcDoc()
    // as the runbook's API load stores them: file order, not start-date order
    doc.cost.family_rates = [
      { session_cm_id: 1000202, standard: '450', infant: '600' },
      { session_cm_id: 1000201, standard: '425', infant: '0' },
    ]
    doc.cost.not_running_session_cm_ids = [1000106, 1000101]
    expect(Object.keys(ok(save([[1000110, 'g', NOT_OPEN]], doc)).contents)).toEqual(['programs'])
  })

  it('a prices-only Save sends cost alone', () => {
    expect(Object.keys(ok(save([[1000101, 't', '6895']])).contents)).toEqual(['cost'])
  })

  it('an AG session no program lists is not written by a prices-only Save (Review Focus 6)', () => {
    const doc = pcDoc()
    doc.programs['summer'] = {
      ...doc.programs['summer']!,
      session_cm_ids: [1000101, 1000102, 1000104, 1000106, 1000107],
    }
    expect(Object.keys(ok(save([[1000101, 't', '6895']], doc)).contents)).toEqual(['cost'])
  })

  it('leaves a price untouched on a session that ends in Not open to aid, even a bad one (spec §5.2 J)', () => {
    const doc = pcDoc()
    const done = save(
      [
        [1000101, 't', '7000'],
        [1000101, 'g', NOT_OPEN],
        [1000104, 't', 'abc'], // a bad box on a row that is moving out of the groups: its box is hidden
        [1000104, 'g', NOT_OPEN],
      ],
      doc
    )
    expect(ok(done).contents.cost).toBeUndefined() // no price written, no red box
    expect(ids(programsOf(done), 'not_aided')).toEqual(expect.arrayContaining([1000101, 1000104])) // 1000103: the AG follows
  })

  it('leaves a price untouched on a session checked Not running, and a bad value there does not block Save (spec §5.2 J)', () => {
    const done = save([
      [1000102, 't', 'abc'],
      [1000102, 'nr', 'true'],
      [1000202, 's', '450'], // half a pair, then the row is checked off
      [1000202, 'nr', 'true'],
    ])
    expect(done.kind).toBe('ok')
    const cost = costOf(done)
    expect((cost['tuition'] as Record<string, string>)['1000102']).toBe('4995')
    expect(cost['not_running_session_cm_ids']).toEqual(expect.arrayContaining([1000102, 1000202]))
    expect(JSON.stringify(cost['family_rates'])).not.toContain('1000202') // the half pair was never read
  })

  it('still reads a price on a session an edit moves out of Not open to aid', () => {
    const done = save([
      [1000901, 'g', 'camp_pool'],
      [1000901, 't', '1200'],
    ])
    expect((costOf(done)['tuition'] as Record<string, string>)['1000901']).toBe('1200')
  })
})
describe('changesSince (spec §5.2 D)', () => {
  it('says each change in session words', () => {
    const approved = pcDoc()
    const draft = pcDoc()
    draft.cost.tuition = { ...draft.cost.tuition, '1000101': '6895' }
    draft.cost.family_rates = [
      ...(draft.cost.family_rates ?? []),
      { session_cm_id: 1000202, standard: '425', infant: '600' },
    ]
    draft.programs['teen']!.session_cm_ids = []
    draft.programs['not_aided']!.session_cm_ids = [1000901, 1000110]
    draft.cost.not_running_session_cm_ids = [1000101]
    expect(changesSince(approved, draft, GROUPS, CATALOG)).toEqual([
      { lead: 'Session 2', was: '$6,695', now: '$6,895' },
      { lead: 'Family Camp B standard', was: 'No price yet', now: '$425' },
      { lead: 'Family Camp B infant', was: 'No price yet', now: '$600' },
      { lead: 'Winter Retreat', was: 'Camp', now: 'Not open to aid' },
      { lead: 'Session 2', was: null, now: 'not running' },
      { lead: 'Quest: Rivers', was: null, now: 'running again' },
    ])
  })

  it('prints Not running lines in one order, whichever way each session turned', () => {
    const approved = pcDoc()
    const draft = pcDoc()
    approved.cost.not_running_session_cm_ids = [1000104] // Starter Session (06-13): running again in the draft
    draft.cost.not_running_session_cm_ids = [1000101] // Session 2 (06-20): newly not running
    expect(changesSince(approved, draft, GROUPS, CATALOG)).toEqual([
      { lead: 'Starter Session', was: null, now: 'running again' },
      { lead: 'Session 2', was: null, now: 'not running' },
    ])
  })
})

describe('the warnings on the rows (spec §5.2 C, G, I)', () => {
  const issue = (code: string, ids: number[], severity = 'warning') =>
    ({
      section: 'cost',
      code,
      severity,
      path: 'cost',
      message: '',
      session_cm_ids: ids,
    }) as ApiAidValidationIssue
  it('pins a price warning to its sessions and words the group pill', () => {
    const pins = pricePins([
      issue('tuition_missing', [1000110]),
      issue('group_mismatch', [1000101]),
    ])
    expect([...pins]).toEqual([1000110])
    expect(groupPill(view().groups[0]!, pins)).toBe('1 with no price')
    const all = pricePins([issue('price_missing', [1000501])])
    expect(groupPill(view().groups[2]!, all)).toBe('No prices yet')
    expect(groupPill(view().groups[1]!, all)).toBeNull()
  })
  it('pins the server’s "in no group" error', () => {
    expect([
      ...noGroupPins([{ ...issue('unmapped_session', [1000902], 'error'), section: 'programs' }]),
    ]).toEqual([1000902])
  })
  it('counts "in no group" on drawn rows only: an AG session follows its parent’s row (Review Focus 6)', () => {
    const pins = noGroupPins([
      { ...issue('unmapped_session', [1000902, 1000103], 'error'), section: 'programs' },
    ])
    expect(noGroupCount(view(), pins)).toBe(1) // 1000103 is an AG session the card never draws
  })
})

describe('the AG line (one session, or several)', () => {
  it('agrees in number', () => {
    expect(agWords(1)).toBe("1 AG session uses its parent session's price")
    expect(agWords(3)).toBe("3 AG sessions use their parent session's price")
  })
})
