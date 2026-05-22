/**
 * Tests for the pure AG collapse/relabel helpers.
 * TDD: written before implementation.
 */
import { describe, it, expect } from 'vitest'
import { collapseAgEnrollments, buildAgParentPairs } from './agCollapse'

interface E {
  sessionType: string
  sessionCmId: number
  parentId: number
}
const e = (sessionType: string, sessionCmId: number, parentId: number): E => ({
  sessionType,
  sessionCmId,
  parentId,
})

describe('collapseAgEnrollments', () => {
  it('drops an AG row when its parent main is also enrolled that year', () => {
    const main = e('main', 100, 0)
    const ag = e('ag', 101, 100)
    expect(collapseAgEnrollments([main, ag])).toEqual([main])
  })

  it('keeps an AG row whose parent main is not enrolled', () => {
    const ag = e('ag', 200, 199)
    expect(collapseAgEnrollments([ag])).toEqual([ag])
  })

  it('keeps a parentless AG row (parentId 0) even when a cm_id-less session puts 0 in the set', () => {
    // sessionCmId defaults to 0 for a session without a cm_id; without the
    // parentId>0 guard, enrolledCmIds.has(0) would wrongly collapse the AG row.
    const cmIdless = e('main', 0, 0)
    const ag = e('ag', 300, 0)
    expect(collapseAgEnrollments([cmIdless, ag])).toEqual([cmIdless, ag])
  })

  it('leaves non-AG rows untouched', () => {
    const rows = [e('main', 1, 0), e('quest', 2, 0), e('embedded', 3, 0)]
    expect(collapseAgEnrollments(rows)).toEqual(rows)
  })
})

describe('buildAgParentPairs', () => {
  it('builds (year, parentId) pairs for surviving AG rows with a real parent', () => {
    const rows = [e('ag', 200, 199), e('main', 100, 0)]
    expect(buildAgParentPairs(rows, 2026)).toEqual([{ year: 2026, cmId: 199 }])
  })

  it('skips AG rows with the 0 sentinel parentId (no bogus cm_id=0 lookup)', () => {
    const rows = [e('ag', 300, 0)]
    expect(buildAgParentPairs(rows, 2026)).toEqual([])
  })
})
