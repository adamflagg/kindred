import { describe, expect, it } from 'vitest'

import { CATALOG, GROUPS, pcDoc } from './programsCostsFixtures'
import { cardView, NOT_OPEN, resolveProgram } from './programsCostsModel'

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
