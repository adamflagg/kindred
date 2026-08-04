/**
 * ONE parse, because two readers of the same string must agree.
 *
 * The form parses `sleeps` to build the payload and the capacity flag parses
 * it to decide what to say about it. If those two ever disagree, the flag
 * reports on a number the save will not store — it would tell a staffer their
 * 100 conflicts with the beds and then quietly write 1.
 */
import { describe, expect, it } from 'vitest'

import { parseSleeps } from './sleepsValue'

describe('parseSleeps — unknown', () => {
  it('reads a blank field as unknown', () => {
    // Not 0: `Number('')` is 0, so a parser built on Number alone turns an
    // untouched field into a real occupancy of nobody.
    expect(parseSleeps('')).toBeNull()
  })

  it('reads whitespace as unknown', () => {
    expect(parseSleeps('   ')).toBeNull()
  })

  it('reads a typed 0 as unknown, matching how PocketBase stores one', () => {
    expect(parseSleeps('0')).toBeNull()
  })

  it('reads a negative as unknown rather than as a number of people', () => {
    expect(parseSleeps('-3')).toBeNull()
  })

  it('reads junk as unknown', () => {
    expect(parseSleeps('abc')).toBeNull()
  })
})

describe('parseSleeps — numbers', () => {
  it('reads a plain whole number', () => {
    expect(parseSleeps('8')).toBe(8)
  })

  it('reads the WHOLE value, not the digits before the exponent', () => {
    // `<input type="number">` accepts any valid floating-point literal, so
    // `1e2` reaches the handler as the string "1e2". Number.parseInt stops at
    // the `e` and yields 1, which is both the wrong flag and the wrong save.
    expect(parseSleeps('1e2')).toBe(100)
  })

  it('truncates a decimal rather than discarding it', () => {
    // The column is onlyInt, so a fraction cannot be stored. Truncating keeps
    // the staffer's intent; treating it as unknown would send 0 on edit and
    // silently CLEAR a number they were in the middle of correcting.
    expect(parseSleeps('4.7')).toBe(4)
  })

  it('ignores surrounding whitespace', () => {
    expect(parseSleeps(' 6 ')).toBe(6)
  })
})
