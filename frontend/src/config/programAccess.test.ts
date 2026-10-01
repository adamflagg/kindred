import { describe, expect, it } from 'vitest'

import { CAMPERSHIPS_OPEN_PERMISSIONS, canOpenCamperships, canOpenProgram } from './programAccess'

const holding = (...granted: string[]) => ({ hasPermission: (p: string) => granted.includes(p) })

describe('canOpenCamperships (D5 as amended by D65)', () => {
  it.each([
    [['financial_aid.view'], true],
    [['financial_aid.summary'], true],
    [['financial_aid.casework'], false],
    [['bunking.manage'], false],
    [[], false],
  ])('%j → %s', (granted, expected) => {
    expect(canOpenCamperships(holding(...granted))).toBe(expected)
  })

  it('opens with view or summary, nothing else', () => {
    expect([...CAMPERSHIPS_OPEN_PERMISSIONS]).toEqual([
      'financial_aid.view',
      'financial_aid.summary',
    ])
  })
})

describe('canOpenProgram', () => {
  it('leaves the three existing programs open to every signed-in user', () => {
    for (const program of ['summer', 'weekend', 'analytics'] as const) {
      expect(canOpenProgram(program, holding())).toBe(true)
    }
  })

  it('gates Camperships, the first permission-gated program', () => {
    expect(canOpenProgram('aid', holding())).toBe(false)
    expect(canOpenProgram('aid', holding('financial_aid.summary'))).toBe(true)
  })
})
