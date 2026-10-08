import { describe, expect, it } from 'vitest'

import { movedFields, movedWords, rebase } from './staleCheck'

describe('movedFields (Decision P-9)', () => {
  const watched = [
    ['name', 'Name'],
    ['programs', 'Programs'],
  ] as const

  it('names the watched fields that moved, lists compared by value', () => {
    expect(
      movedFields({ name: 'A', programs: ['summer'] }, { name: 'A', programs: ['summer'] }, watched)
    ).toEqual([])
    expect(
      movedFields({ name: 'A', programs: ['summer'] }, { name: 'B', programs: ['quest'] }, watched)
    ).toEqual(['Name', 'Programs'])
  })

  it('ignores a field nobody watches', () => {
    expect(
      movedFields(
        { name: 'A', programs: [], note: 'x' },
        { name: 'A', programs: [], note: 'y' },
        watched
      )
    ).toEqual([])
  })

  it('says nothing was saved, the changes are kept, and a second Save puts it in place', () => {
    expect(movedWords(['Programs'])).toBe(
      'Someone changed this since you opened it: Programs. Nothing was saved. Your changes are kept; everything else now shows the latest. Save again to put your edit in its place.'
    )
  })
})

describe("rebase (review R3-1: the second Save must not undo someone else's change)", () => {
  it('keeps the fields the person changed and takes every other from the latest', () => {
    const opened = { name: 'A', programs: ['summer'], note: '' }
    const typed = { name: 'A', programs: ['summer'], note: 'Fix the name later' }
    const latest = { name: 'A', programs: ['quest'], note: '' }
    expect(rebase(opened, latest, typed)).toEqual({
      name: 'A',
      programs: ['quest'],
      note: 'Fix the name later',
    })
  })

  it('keeps a typed field even where the latest moved it too: the later save wins', () => {
    expect(rebase({ name: 'A' }, { name: 'B' }, { name: 'C' })).toEqual({ name: 'C' })
  })
})
