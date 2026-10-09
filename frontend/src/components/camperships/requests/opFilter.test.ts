import { describe, expect, it } from 'vitest'

import { DETAIL_POSTED } from '../season/historyFixtures'
import { OP_MISSING, opRequestIds, parseOp } from './opFilter'

describe('the grid filter ?op= (spec §9.8)', () => {
  it('reads a real operation id only', () => {
    expect(parseOp('abcdefghij12345')).toBe('abcdefghij12345')
    expect(parseOp('../x')).toBeNull()
    expect(parseOp(null)).toBeNull()
  })

  it('collects the distinct request ids of the operation rows, none while it loads', () => {
    const rows = DETAIL_POSTED.rows
      .slice(0, 3)
      .map((r, i) => ({ ...r, request_id: i === 2 ? 'r1' : `r${String(i)}` }))
    expect(opRequestIds({ ...DETAIL_POSTED, rows })).toEqual(new Set(['r0', 'r1']))
    expect(opRequestIds(undefined)).toBeNull()
  })

  it('says the missing operation in the grid grammar', () => {
    expect(OP_MISSING).toBe("That History operation isn't in the log you can read")
  })
})
