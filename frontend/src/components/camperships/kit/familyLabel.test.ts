/** The family's name on Money and Grants (ruling D): the household card's label, else the old name. */
import { describe, expect, it } from 'vitest'

import { familyLabel } from './familyLabel'

describe('familyLabel', () => {
  it("reads the server's label and its tie-break", () => {
    expect(
      familyLabel({ label: 'Pat & Sam Johnson', label_tiebreak: '#1000001' }, 'Johnson')
    ).toEqual({ text: 'Pat & Sam Johnson', tiebreak: '#1000001' })
    expect(familyLabel({ label: 'Pat & Sam Johnson', label_tiebreak: '' }, 'Johnson')).toEqual({
      text: 'Pat & Sam Johnson',
      tiebreak: '',
    })
  })

  it('keeps the old name when the label is blank, and a dash when there is none', () => {
    expect(familyLabel({ label: '  ', label_tiebreak: '#1000001' }, 'Johnson')).toEqual({
      text: 'Johnson',
      tiebreak: '',
    })
    expect(familyLabel({}, '')).toEqual({ text: '—', tiebreak: '' })
  })
})
